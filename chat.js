import fs from "fs";
import axios from "axios";
import OpenAI from "openai";
import Speaker from "speaker";
import { config } from "dotenv";
import readline from "readline";
import FormData from "form-data";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import Microphone from "node-microphone";

import debug from "./debug.js";
config();


class VoAssitant {
  static secretKey;
  static openai;
  static chatHistory = [];                /*To store the conversation history*/
  static mic;                             /*Microphone*/
  static outputFile;                      /*output file*/
  static micStream;                       /*microphone stream*/
  static rl;                              /*readline interface*/

  static inputVoice;                      /*https://platform.openai.com/docs/guides/text-to-speech/voice-options*/
  static inputModel;                      /*https://platform.openai.com/docs/guides/text-to-speech/audio-quality*/
  
  constructor() {
  }

  static {

    this.inputVoice = "echo";     
    this.inputModel = "tts-1";

    ffmpeg.setFfmpegPath(ffmpegPath);     /*Set the path for FFmpeg, used for audio processing*/
    this.secretKey = process.env.OPENAI_API_KEY;
    this.openai = new OpenAI({ apiKey: this.secretKey, });
    this.initReadLine();
  }

  static initReadLine() {

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,                     /*Make sure the terminal can capture keypress events*/
    });

    readline.emitKeypressEvents(process.stdin, this.rl);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdin.on("keypress", (str, key) => {
      if (key?.name.toLowerCase() === "space"){
        if (this.micStream) {
          this.stopRecordingAndProcess();
        } else {
          this.startRecording();
        }
      } else if (key && key.ctrl && key.name === "c") {
        process.exit();
      } else if (key) {
        debug.log("Exiting application...");
        process.exit(0);
      }
    });

  };

  static startRecording() {

    try {
      this.mic = new Microphone();
      this.outputFile = fs.createWriteStream("output.wav");
      this.micStream = this.mic.startRecording();

      this.micStream.on("data", (data) => {                   /*Write incoming data to the output file*/
        debug.log(data);
        this.outputFile.write(data);
      });

      this.micStream.on("error", (error) => {
        debug.error("Error: ", error);
      });
      debug.log("Recording... Press [Space] to stop");
    }
    catch (error) {
      debug.log(error);
    }
  }

  static stopRecordingAndProcess() {

    this.mic.stopRecording();
    this.outputFile.end();
    debug.log(`Recording stopped, processing audio...`);
    this.transcribeAndChat();
  }

  /*convert text to speech and play it using Speaker*/
  static async streamedAudio(inputText, model = this.inputModel, voice = this.inputVoice) {
    const url = "https://api.openai.com/v1/audio/speech";
    const headers = {
      Authorization: `Bearer ${this.secretKey}`,
    };

    const data = {
      model: model,
      input: inputText,
      voice: voice,
      response_format: "mp3",
    };

    try {
      const response = await axios.post(url, data, {
        headers: headers,
        responseType: "stream",
      });

      /*Configure speaker*/
      const speaker = new Speaker({
        channels: 2,                    /*Stereo audio*/
        bitDepth: 16,
        sampleRate: 44100,
      });

      /*Convert the response to the desired audio format and play*/
      ffmpeg(response.data)
        .toFormat("s16le")
        .audioChannels(2)
        .audioFrequency(44100)
        .pipe(speaker);
    } catch (error) {
      if (error.response) {
        debug.error(
          `Error with HTTP request: ${error.response.status} - ${error.response.statusText}`
        );
      } else {
        debug.error(`Error in streamedAudio: ${error.message}`);
      }
    }
  }
  
  /*transcribe audio to text and send it to the chatbot*/
  static async transcribeAndChat() {

    const filePath = "output.wav";                  /*note file size limitations are 25MB for Whisper*/
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
    form.append("model", "whisper-1");
    form.append("response_format", "text");

    try {
      const transcriptionResponse = await axios.post(
        "https://api.openai.com/v1/audio/transcriptions",
        form,
        {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${this.secretKey}`,
          },
        }
      );

      const transcribedText = transcriptionResponse.data;
      debug.log(`>> You said: ${transcribedText}`);

      const messages = [
        {
          role: "system",
          content:
            "You are a helpful assistant providing concise responses in at most two sentences.",
        },
        ...this.chatHistory,
        { role: "user", content: transcribedText },
      ];


      const chatResponse = await this.openai.chat.completions.create({
        messages: messages,
        model: "gpt-3.5-turbo",
      });
      const chatResponseText = chatResponse.choices[0].message.content;
      this.chatHistory.push(
        { role: "user", content: transcribedText },
        { role: "assistant", content: chatResponseText }
      );

      /*Convert the chat response to speech and play*/
      await this.streamedAudio(chatResponseText);
      debug.log(`>> Assistant said: ${chatResponseText}`);

      /*Reset microphone stream*/
      this.micStream = null;
      debug.log("Press [Space] to speak again, or any other key to quit.\n");
    } catch (error) {
      if (error.response) {
        debug.log(
          `Error: ${error.response.status} - ${error.response.statusText}`
        );
      } else {
        debug.log("Error:", error.message);
      }
    }
  }

  static start() {
    
    debug.out(`\n
**************************** 
Welcome to your AI-powered voice chat 
****************************
Press [Space] when you're ready to start speaking`
    );
  }

}

VoAssitant.start();