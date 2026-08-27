# Desi Trivia Race

A two-player real-time trivia race — India-focused MCQs across Bollywood, food,
the Hindi-belt states, cricket and desi internet culture. Both players see the
same question at the same time; fastest correct answer takes the speed bonus.

Static frontend (deploys to GitHub Pages) + Firebase Firestore for live sync.
No server to run, no cost.

---

## How the game works

- One person **creates a room** and gets a 4-letter code.
- The other **joins** with that code (or opens the copied invite link).
- Host picks number of questions, seconds per question, and category.
- Each round: question appears, timer runs, both answer.
- Round ends when both have answered **or** the timer expires.
- Answers are revealed for ~3.5s, then the next question loads.

**Scoring per correct answer**

| Component | Points |
|---|---|
| Correct answer | 100 |
| Speed bonus | up to 100, scaled by how much time was left |
| First correct (when both got it right) | +50 |

Reaction time is measured locally on each device from the moment the question
appears, so a clock difference between your two phones can't skew the race.

---

## Setup

### 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**.
   Name it anything. You can turn Google Analytics off.
2. In the left sidebar: **Build → Firestore Database → Create database**.
3. Pick any location, and choose **Start in test mode**.
4. Left sidebar → the gear icon → **Project settings**.
5. Scroll to **Your apps**, click the web icon (`</>`), give it a nickname,
   and register. Do **not** enable Firebase Hosting — GitHub Pages handles that.
6. Copy the `firebaseConfig` object it shows you.

### 2. Paste the config

Open `firebase-config.js` and replace every `PASTE_ME` with your values.

> These keys are safe to commit. Firebase web API keys are public identifiers,
> not secrets — access is controlled by the security rules below, not the key.

### 3. Lock down the security rules

Test mode stops working after 30 days. Before that, go to
**Firestore Database → Rules**, replace what's there with the contents of
`firestore.rules` in this repo, and hit **Publish**.

---

## Deploy to GitHub Pages

From inside this folder:

```bash
git init && git add . && git commit -m "Desi Trivia Race"
```

Create an empty repo on GitHub (no README, no .gitignore), then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/desi-trivia-race.git
```

```bash
git branch -M main && git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch →
Branch: `main`, folder: `/ (root)` → Save.**

After a minute your game is live at:

```
https://YOUR-USERNAME.github.io/desi-trivia-race/
```

Send that link to your girlfriend. One of you creates a room, the other joins.

---

## Files

| File | What it does |
|---|---|
| `index.html` | All four screens (setup, lobby, game, results) |
| `style.css` | Styling, mobile-first |
| `questions.js` | The question bank — 121 MCQs |
| `app.js` | Game logic and Firestore sync |
| `firebase-config.js` | Your Firebase keys (you fill this in) |
| `firestore.rules` | Security rules to paste into the Firebase console |

## Adding your own questions

Append to the array in `questions.js`:

```js
{
  q: 'Your question?',
  options: ['A', 'B', 'C', 'D'],
  answer: 2,          // index of the correct option, 0-3
  cat: 'bollywood',   // bollywood | food | states | general | cricket | pop
  diff: 'medium',     // easy | medium | hard
}
```

Personal "about us" questions work well here — add a new category and give it
an option in the category dropdown in `index.html`.

## Testing locally

Because `app.js` is an ES module, opening `index.html` directly as a file
won't work — it needs to be served over HTTP. Any static server will do; the
simplest is the VS Code **Live Server** extension. Or just push to GitHub Pages
and test there.
