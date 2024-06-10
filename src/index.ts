import wppconnect from '@wppconnect-team/wppconnect';
import dotenv from 'dotenv';
import { initializeNewAIChatSession, mainOpenAI } from './service/openai';
import { splitMessages, sendMessagesWithDelay } from './util';
import { mainGoogle } from './service/google';

dotenv.config();
type AIOption = 'GPT' | 'GEMINI';

const messageBufferPerChatId = new Map();
const messageTimeouts = new Map();
const AI_SELECTED: AIOption = (process.env.AI_SELECTED as AIOption) || 'GEMINI';
const MAX_RETRIES = 3;

if (AI_SELECTED === 'GEMINI' && !process.env.GEMINI_KEY) {
  throw new Error(
    'Você precisa colocar uma chave do Gemini no .env! Crie uma gratuitamente em https://aistudio.google.com/app/apikey?hl=pt-br'
  );
}

if (
  AI_SELECTED === 'GPT' &&
  (!process.env.OPENAI_KEY || !process.env.OPENAI_ASSISTANT)
) {
  throw new Error(
    'Para utilizar o GPT você precisa colocar no .env a sua chave da OpenAI e o ID do seu assistente.'
  );
}

wppconnect
  .create({
    session: 'sessionName',
    catchQR: (base64Qrimg, asciiQR, attempts, urlCode) => {
      console.log('Terminal QR Code:', asciiQR);
    },
    statusFind: (statusSession, session) => {
      console.log('Status da Sessão:', statusSession);
      console.log('Nome da Sessão:', session);
    },
    headless: false // Alterado para false
  })
  .then((client) => {
    start(client);
  })
  .catch((error) => {
    console.error('Erro ao iniciar o cliente:', error);
  });

async function start(client: wppconnect.Whatsapp): Promise<void> {
  client.onMessage(async (message) => {
    if (
      message.type === 'chat' &&
      !message.isGroupMsg &&
      message.chatId !== 'status@broadcast'
    ) {
      const chatId = message.chatId;
      console.log('Mensagem recebida:', message.body);
      if (AI_SELECTED === 'GPT') {
        await initializeNewAIChatSession(chatId);
      }

      if (!messageBufferPerChatId.has(chatId)) {
        messageBufferPerChatId.set(chatId, [message.body]);
      } else {
        messageBufferPerChatId.set(chatId, [
          ...messageBufferPerChatId.get(chatId),
          message.body,
        ]);
      }

      if (messageTimeouts.has(chatId)) {
        clearTimeout(messageTimeouts.get(chatId));
      }

      console.log('Aguardando novas mensagens...');
      messageTimeouts.set(
        chatId,
        setTimeout(async () => {
          const currentMessage = !messageBufferPerChatId.has(chatId)
            ? message.body
            : [...messageBufferPerChatId.get(chatId)].join(' \n ');
          let answer = '';

          // Indicando que estamos digitando
          client.startTyping(chatId).catch(console.error);

          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
              if (AI_SELECTED === 'GPT') {
                answer = await mainOpenAI({
                  currentMessage,
                  chatId,
                });
              } else {
                answer = await mainGoogle({
                  currentMessage,
                  chatId,
                });
              }
              break;
            } catch (error) {
              if (attempt === MAX_RETRIES) {
                throw error;
              }
            }
          }

          // Parando a indicação de que estamos digitando
          client.stopTyping(chatId).catch(console.error);

          const messages = splitMessages(answer);
          console.log('Enviando mensagens...');
          await sendMessagesWithDelay({
            client,
            messages,
            targetNumber: message.from,
          });

          messageBufferPerChatId.delete(chatId);
          messageTimeouts.delete(chatId);
        }, 15000)
      );
    }
  });
}

