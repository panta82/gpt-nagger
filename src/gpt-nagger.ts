#!/usr/bin/env ts-node-script

import fs from 'fs';
import libPath from 'path';

import OpenAI from 'openai';
import dotenv from 'dotenv';

import { exec as execCb } from 'child_process';
import { promisify } from 'util';
const exec = promisify(execCb);

dotenv.config();

const client = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'],
});

const INTERVAL = 30 * 1000;

const PROMPT_GOAL = process.env.PROMPT_GOAL || 'write scripts';
const IMAGE_PATH = process.env.IMAGE_PATH || libPath.resolve(__dirname, '../screenshot.png');
const SPEECH_PATH = process.env.SPEECH_PATH || libPath.resolve(__dirname, '../speech.mp3');
const SCREEN_CAPTURE_CMD = process.env.SCREEN_CAPTURE_CMD || `screencapture -x`;
const PLAY_SPEECH_CMD = process.env.PLAY_SPEECH_CMD || `afplay`;

Promise.resolve()
  .then(main)
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

export async function main() {
  let breakTriggered = false;
  let waitTimeout;

  process.on('SIGINT', async () => {
    console.log('Exiting...');
    clearTimeout(waitTimeout);
    if (!breakTriggered) {
      breakTriggered = true;
    } else {
      process.exit(1);
    }
  });

  let previousMessage: string;

  while (!breakTriggered) {
    console.log(`\n[${new Date().toISOString()}]\nLet's see how you're doing...`);

    previousMessage = await nag(previousMessage);

    console.log(`Hope that helps!`);

    if (breakTriggered) {
      break;
    }

    await new Promise(resolve => {
      waitTimeout = setTimeout(resolve, INTERVAL);
    });
  }
}

async function nag(previousMessage?: string) {
  const systemPrompt = `You are a system designed to observe the user's computer usage and help them. 
One part of help is motivation - ensuring they're not getting distracted doing the wrong thing - 
another is making suggestions for whatever task they seem to be doing. 
SHORT ONE LINE QUIPS BY DEFAULT, the user will specifically ask for details if needed. 
Think of yourself as the 2ndary in a pair programming scenario, looking over someones shoulder.`;

  let userPrompt = `I am trying to ${PROMPT_GOAL}. Look at my screen and make sure I am not slacking off. If I am, sternly reprimand me and guide me back to the right path. If it looks like I am doing what I should, try to help me out with a short quip.`;
  if (previousMessage) {
    userPrompt += ` The last time you said: ${previousMessage}`;
  }

  await exec(`${SCREEN_CAPTURE_CMD} ${IMAGE_PATH}`);

  console.log('Analyzing...');

  const base64_image = await encodeImage(IMAGE_PATH);
  const result = await client.chat.completions.create({
    model: 'gpt-4-vision-preview',
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${base64_image}`,
            },
          },
        ],
      },
    ],
  });

  console.log('Nagging...');

  const message = result.choices[0].message.content;

  console.log('---\n' + message + '\n---');

  const voiceResponse = await client.audio.speech.create({
    voice: 'nova',
    input: message,
    model: 'tts-1',
  });
  const buffer = Buffer.from(await voiceResponse.arrayBuffer());
  await fs.promises.writeFile(SPEECH_PATH, buffer);

  await exec(`${PLAY_SPEECH_CMD} ${SPEECH_PATH}`);

  return message;
}

const encodeImage = async (imagePath: string): Promise<string> => {
  const bitmap = fs.readFileSync(imagePath);
  return Buffer.from(bitmap).toString('base64');
};
