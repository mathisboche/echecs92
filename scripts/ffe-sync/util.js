const fs = require('node:fs');
const path = require('node:path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const limitConcurrency = (concurrency) => {
  const queue = [];
  let active = 0;

  const next = () => {
    if (active >= concurrency || queue.length === 0) {
      return;
    }
    const { fn, resolve, reject } = queue.shift();
    active += 1;
    Promise.resolve()
      .then(fn)
      .then((value) => {
        active -= 1;
        resolve(value);
        next();
      })
      .catch((err) => {
        active -= 1;
        reject(err);
        next();
      });
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
};

const writeJson = (filePath, data) => {
  const output = `${JSON.stringify(data, null, 2)}\n`;
  const targetDir = path.dirname(filePath);
  const tempPath = path.join(
    targetDir,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );

  fs.mkdirSync(targetDir, { recursive: true });
  try {
    fs.writeFileSync(tempPath, output);
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }
  }
};

module.exports = {
  limitConcurrency,
  sleep,
  writeJson,
};
