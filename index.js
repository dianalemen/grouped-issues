const fs = require("fs");
const path = require("path");
const { stdout } = require('process');
const { exec } = require("child_process");

const formatter = require("./lint-formatter");

function streamToString(fStream, sStream, cb) {
  return new Promise((resolve) => {
    const errorChunks = [];
    let ownerChunks = [];

    fStream.on("data", (chunk) => {
      errorChunks.push(chunk.toString());
    });

    fStream.on("end", () => {
      sStream.on("data", (chunk) => {
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

      sStream.on("end", () => {
        cb(JSON.parse(errorChunks.join("")), ownerChunks);
        resolve("done!");
      });
    });
  });
}

const writeIntoFile = (errors, owners) => {
  const grouppedErrors = [];
  const shared = {};
  const gruoped = Object.entries(owners).reduce((acc, [key, value]) => {
    const gruopedTest = Object.entries(errors).reduce(
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
  console.log(errors)
  const readCodeownersStream = fs.createReadStream(
    `${path.resolve()}/.github/CODEOWNERS`,
    "utf8"
  );
  const readErrorStream = fs.createReadStream(
    `${path.resolve()}/results.json`,
    "utf8"
  );
  const res = await streamToString(
    readErrorStream,
    readCodeownersStream,
    writeIntoFile
  );
  return res;
};

const runLinterScript = () => new Promise((resolve, reject) => {
  const formatter = (results) => {
    const byRuleId = results.reduce((map, current) => {
      current.messages.forEach(({ ruleId, line, column }) => {
        if (!map[ruleId]) {
          map[ruleId] = [];
        }

        const occurrence = `${current.filePath}:${line}:${column}`;
        map[ruleId].push(occurrence);
      });
      return map;
    }, {});

    return JSON.stringify(byRuleId, null, 2);
  };
  return exec("npm run test:lint", (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(formatter(stdout));
    });
  })

module.exports = () => {
  runLinterScript()
    .then((res) => {
      console.log("Linter finished! Output is creating for you...");
      waitForWriting(res);
    })
    .catch((err) => console.log("A complete log of test:lint run"))
    .finally(() => {
      waitForWriting().then(() => {
        fs.rm(`${path.resolve()}/lint-formatter.js`, {}, (err) =>
          console.log(err)
        );
        fs.rm(`${path.resolve()}/results.json`, {}, (err) => console.log(err));
      });
    });
};
