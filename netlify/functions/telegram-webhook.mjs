export default async (req) => {
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  let update;
  try {
    update = await req.json();
  } catch {
    return new Response("OK", { status: 200 });
  }

  const text = update?.message?.text;
  const chatId = update?.message?.chat?.id;

  if (text === "/start" && chatId) {
    const token = Netlify.env.get("TELEGRAM_BOT_TOKEN");

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "Welcome to Watermelina 🍉💨\nTap below to play and start earning rewards.",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Play Game 🎮",
                web_app: { url: "https://www.watermelinafart.com/game" },
              },
            ],
          ],
        },
      }),
    });
  }

  return new Response("OK", { status: 200 });
};
