#!/usr/bin/env ts-node-script

import fs from 'fs';
import libPath from 'path';

import Moment from 'moment';

import OpenAI from 'openai';
import dotenv from 'dotenv';

import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { ChatCompletionContentPart } from 'openai/src/resources/chat/completions';
const exec = promisify(execCb);

dotenv.config();

const client = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'],
});

const INTERVAL = isNaN(parseInt(process.env.INTERVAL)) ? 30 * 1000 : parseInt(process.env.INTERVAL);
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

  let previousNags: INag[] = [];

  while (!breakTriggered) {
    console.log(`\n[${new Date().toISOString()}]\nLet's see how you're doing...`);

    const [text, screenshotDataUri] = await performNag(previousNags);
    if (text) {
      previousNags.push({ text, screenshotDataUri, date: new Date() });
      if (previousNags.length > 3) {
        previousNags = previousNags.slice(-3);
      }
    }

    if (breakTriggered) {
      break;
    }

    await new Promise(resolve => {
      waitTimeout = setTimeout(resolve, INTERVAL);
    });
  }
}

async function performNag(
  previousNags?: INag[]
): Promise<[message: string, screenshotDataUri: string]> {
  const systemPrompt = `You are a system designed to observe the user's computer usage and help them STAY FOCUSED on the task at hand.
Imagine your voice coming from a strict but fair teacher, keeping the class in check.
Communication short and to the point. SHORT ONE LINE QUIPS BY DEFAULT.
First gentle, but more strict if the behaviour doesn't improve. Cursing allowed.`;

  const currentPrompt = [
    `I am trying to ${PROMPT_GOAL}.`,
    `Here is my CURRENT screen.`,
    `Look at it and make sure I am working on my task.`,
    'Forbidden activities involve twitter, x.com, video games and other distractions.',
    `If I am doing well, say EXACTLY "Good boy".`,
    `Otherwise reprimand me. Take into account previous warnings and times, and escalate as needed.`,
  ]
    .filter(Boolean)
    .join('\n');

  // Doesn't work, it doesn't understand what to do :(
  // const compareInstructions: ChatCompletionContentPart[] = previousNags?.length
  //   ? [
  //       {
  //         type: 'text',
  //         text: [
  //           `Also, here is my screen from ${Moment(previousNags[previousNags.length - 1].date).fromNow()}. Compare with the CURRENT screen. If they are similar, I might be drifting off!`,
  //         ].join('\n'),
  //       },
  //       {
  //         type: 'image_url',
  //         image_url: {
  //           url: previousNags[previousNags.length - 1].screenshotDataUri,
  //         },
  //       },
  //     ]
  //   : [];

  await exec(`${SCREEN_CAPTURE_CMD} ${IMAGE_PATH}`);

  console.log('Analyzing...');

  const dataUriScreenshot = await encodeImage(IMAGE_PATH);
  const result = await client.chat.completions.create({
    model: 'gpt-4-vision-preview',
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      ...previousNags
        .filter(nag => !!nag.text)
        .map(
          nag =>
            ({
              role: 'assistant',
              content: `[${Moment(nag.date).fromNow()}] ${nag.text}`,
            }) as const
        ),
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: currentPrompt,
          },
          {
            type: 'image_url',
            image_url: {
              url: dataUriScreenshot,
            },
          },
          //...compareInstructions,
        ],
      },
    ],
  });

  console.log('Nagging...');

  const message = result.choices[0].message.content;

  console.log('---\n' + message + '\n---');

  if (/GOOD\s+BOY/i.test(message)) {
    return [null, dataUriScreenshot];
  }

  const voiceResponse = await client.audio.speech.create({
    voice: 'nova',
    input: message,
    model: 'tts-1',
  });
  const buffer = Buffer.from(await voiceResponse.arrayBuffer());
  await fs.promises.writeFile(SPEECH_PATH, buffer);

  await exec(`${PLAY_SPEECH_CMD} ${SPEECH_PATH}`);

  return [message, dataUriScreenshot];
}

const encodeImage = async (imagePath: string): Promise<string> => {
  const bitmap = fs.readFileSync(imagePath);
  const content = Buffer.from(bitmap).toString('base64');
  return `data:image/png;base64,${content}`;
};

interface INag {
  date: Date;
  text: string;
  screenshotDataUri: string;
}
