# 📘 Local LLM Setup

This guide explains how to set up your private large lang model on your Mac. This app uses Node.js for the logic, SQLite for your history, and Ollama to run the models locally.

---

## 1. Install Core Software

### Ollama (The AI Engine)
1. Download the Mac version from https://ollama.com.
2. Or use this command for ollama installation: `curl -fsSL https://ollama.com/install.sh | sh`
3. verify ollama installation with: `ollama list`

### Homebrew & Node.js
On Mac, the most efficient way to manage software is via Homebrew. Open your Terminal and follow these steps:

1. Install Homebrew (if not already installed): 

   `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`

2. Install Node.js & NPM:
   `brew install node`

3. Verify Installation: 

   `node -v`

   `npm -v`

---

## 2. Download the Models
Before running the app, you need to "pull" the models to your local drive. Open your terminal and run:

* General Queries (Gemma 3): `ollama pull gemma3:4b`
* Coding & Logic (Qwen 3): `ollama pull qwen3:latest`
* Deep Reasoning (DeepSeek):  `ollama pull deepseek-r1`

---

## 3. App Installation & Setup

1. Open a terminal window. and install the required dependencies with npm
   `npm install`

---

## 4. Launch the App

To start your local study environment, run the following command in your project folder:

   `node app.js`

Once running, open your browser and go to: http://localhost:3000