const fs = require('fs/promises');
const { v1: uuidv1 } = require('uuid');

let fileName = '';
var sep = "";

const initLogFile = async () => {
    fileName = "data/" + uuidv1() + ".txt";
    await fs.writeFile(fileName, "[", function (err) {
        if (err) return console.log(err);
    });

}

const logToFile = async (record) => {
    const data = sep + JSON.stringify(record);
    if (!sep)
        sep = ",\r\n";
    await fs.appendFile(fileName, data, function (err) {
        if (err) return console.log(err);
    });
}

const closeLogFile = async () => {
    await fs.appendFile(fileName, "]", function (err) {
        if (err) return console.log(err);
    });
}

module.exports = {initLogFile, logToFile, closeLogFile}