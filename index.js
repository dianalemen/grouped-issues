const fs = require("fs");
const path = require("path");
const { stdout } = require("process");
const { ESLint } = require("eslint");

const eslint = new ESLint();

function streamToString(stream, errors, cb) {
  return new Promise((resolve) => {
    const errorChunks = errors;
    let ownerChunks = [];

    stream.on("data", (chunk) => {
      ownerChunks = chunk
        .split("\n")
        .filter((val) => val.includes("@"))
        .map((val) => val.replaceAll("**", "").replaceAll("*", ""))
        .reduce((acc, val) => {
          const [filePath, owner] = val.replace(/\s\s+/g, " ").split(" ");
          acc[owner]
            ? (acc[owner] = [...acc[owner], filePath])
            : (acc[owner] = [filePath]);
          return acc;
        }, {});
    });

    stream.on("end", () => {
      cb(errorChunks, ownerChunks);
      resolve("done!");
    });
  });
}

const writeIntoFile = (errors, owners) => {
  const grouppedErrors = [];
  const shared = {};
  const gruoped = Object.entries(owners).reduce((acc, [key, value]) => {
    const gruopedTest = Object.entries(JSON.parse(errors)).reduce(
      (errAcc, [errKey, errVal]) => {
        errVal.forEach((error) => {
          value.forEach((errPath) => {
            if (error.includes(errPath.trim())) {
              grouppedErrors.push(error);
              errAcc[errKey] = errAcc[errKey]
                ? [...errAcc[errKey], error]
                : [error];
            } else {
              shared[error] = errKey;
            }
          });
        });
        return errAcc;
      },
      {}
    );
    acc[key] = acc[key] ? { ...acc[key], ...gruopedTest } : gruopedTest;
    return acc;
  }, {});

  const newShared = Object.entries(shared).reduce(
    (acc, [key, val]) => {
      if (!grouppedErrors.find((item) => item === key)) {
        acc.SHARED[val] = acc.SHARED[val] ? [...acc.SHARED[val], key] : [key];
      }

      return acc;
    },
    { SHARED: {} }
  );

  stdout.write(JSON.stringify({ ...gruoped, ...newShared }, null, 2));
};

const waitForWriting = async (errors) => {
  if (errors) {
    const readCodeownersStream = fs.createReadStream(
      `${path.resolve()}/.github/CODEOWNERS`,
      "utf8"
    );
    const res = await streamToString(
      readCodeownersStream,
      errors,
      writeIntoFile
    );
    return res;
  } else {
    console.log("done!");
  }
};

const runLinterScript = async () => {
  const formatter = await eslint.loadFormatter("./lint-formatter.js");
  const results = await eslint.lintFiles([
    `${path.resolve()}/app/javascript/{**/*,*}.{js,ts,jsx,tsx}`,
  ]);

  return formatter.format(results);
};

module.exports = () => {
  runLinterScript()
    .then((res) => {
      console.log("Linter finished! Output is creating for you...");
      waitForWriting(res);
    })
    .catch((err) => console.log("A complete log of test:lint run"))
    .finally(() => {
      waitForWriting()
    });
};
