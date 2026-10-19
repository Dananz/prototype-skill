// Hebrew for the core strings (ui.ts, settings.ts, i18n.ts): the English as written in t(), then
// the Hebrew. Address the user in masculine singular (בחר, שלח). Keep variant letters, shortcuts
// and placeholders ({n}) as they are.
export default {
  'just now': 'עכשיו',
  '{n}s ago': 'לפני {n} שנ׳',
  '{n} min ago': 'לפני {n} דק׳',
  '{n}h ago': 'לפני {n} שע׳',
  '{n}d ago': 'לפני {n} ימים',
  'Language': 'שפה',
  'The words around your designs. The designs keep their own.': 'השפה של סביבת העבודה. העיצובים נשארים בשפה שלהם.',
  'Conversation': 'לפי השיחה',
  'Follows the language you talk to the agent in, now {name}.': 'לפי השפה שבה אתה מדבר עם הסוכן, כרגע {name}.',
  'Always {name} in this browser.': 'תמיד {name} בדפדפן הזה.',
} satisfies Record<string, string>
