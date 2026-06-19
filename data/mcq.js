const mcqQuestions = [
  { level: '🟢 Easy', question: 'What does the S&P 500 track?', options: ['A — Top 500 US companies by market cap', 'B — Top 500 global companies', 'C — Top 500 tech companies only', 'D — No idea, just here for the memes'], answer: 'A', explanation: 'The S&P 500 tracks the 500 largest publicly traded companies in the US by market capitalisation. It is the most widely followed benchmark for the US stock market.' },
  { level: '🟡 Medium', question: 'When the Fed raises interest rates, what typically happens to bond prices?', options: ['A — They go up', 'B — They go down', 'C — They stay the same', 'D — What is a bond?'], answer: 'B', explanation: 'When interest rates rise, existing bond prices fall. New bonds are issued at higher rates making older lower-rate bonds less attractive to investors.' },
  { level: '🔴 Hard', question: 'What does a yield curve inversion typically signal?', options: ['A — Strong economic growth ahead', 'B — Potential recession ahead', 'C — High inflation incoming', 'D — Time to Google this'], answer: 'B', explanation: 'A yield curve inversion happens when short-term bond yields exceed long-term yields. Historically this has been one of the most reliable indicators of a coming recession.' },
  { level: '🟢 Easy', question: 'What does GDP stand for?', options: ['A — Global Development Plan', 'B — Gross Domestic Product', 'C — General Dollar Price', 'D — I know this one... maybe'], answer: 'B', explanation: 'GDP stands for Gross Domestic Product. It measures the total value of all goods and services produced in a country and is the primary measure of economic health.' },
  { level: '🟡 Medium', question: 'What does CPI measure?', options: ['A — Corporate Price Index', 'B — Consumer Price Index that tracks inflation', 'C — Central Policy Interest rate', 'D — No clue'], answer: 'B', explanation: 'CPI stands for Consumer Price Index. It tracks the average change in prices paid by consumers for goods and services. Central banks use it to measure inflation.' },
  { level: '🔴 Hard', question: 'What is quantitative easing?', options: ['A — A central bank selling bonds to reduce money supply', 'B — A central bank buying bonds to inject money into the economy', 'C — A government raising taxes to control inflation', 'D — A way to make economics easier to understand'], answer: 'B', explanation: 'Quantitative easing is when a central bank purchases bonds to inject money into the economy. It is used to stimulate growth when interest rates are already near zero.' },
  { level: '🟢 Easy', question: 'What does a bear market mean?', options: ['A — Markets are rising strongly', 'B — Markets have fallen 20% or more from recent highs', 'C — A market dominated by animal stocks', 'D — When traders are in a bad mood'], answer: 'B', explanation: 'A bear market is defined as a decline of 20% or more from recent highs in a market index. It reflects widespread pessimism and negative investor sentiment.' },
  { level: '🟡 Medium', question: 'What is the main purpose of the Federal Reserve?', options: ['A — To print money for the US government', 'B — To manage monetary policy and maintain economic stability', 'C — To regulate Wall Street banks only', 'D — To decide stock prices'], answer: 'B', explanation: 'The Federal Reserve is the US central bank. Its main goals are to promote maximum employment, stable prices and moderate long-term interest rates through monetary policy.' }
];

// Mutable state shared between commands and scheduler.
// currentMCQs holds the three questions (Easy/Medium/Hard) posted at 10am
// so the 11am job can reveal their answers.
const mcqState = {
  currentMCQIndex: 0,
  currentMCQs: []
};

module.exports = { mcqQuestions, mcqState };
