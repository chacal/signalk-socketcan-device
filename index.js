const moment = require('moment')
const concentrate = require('concentrate')
const R = require('ramda')
const Bacon = require('baconjs')
const readline = require('readline')

const timestampFmt = "YYYY-MM-DD-HH:mm:ss.SSS"
let ownAddr = 100

const addressClaim = {
  src: ownAddr,
  dst: 255,
  uniqueNumber: 1,
  manufacturerCode: 2000,
  deviceFunction: 130,  // PC gateway
  deviceClass: 25,      // Inter/Intranetwork Device
  deviceInstanceLower: 0,
  deviceInstanceUpper: 0,
  systemInstance: 0,
  industryGroup: 4      // Marine
}

const productInfo = {
  src: ownAddr,
  dst: 255,
  n2kVersion: 1300,
  productCode: 666,   // Just made up..
  modelId: "SignalK socketcan n2k-device",
  swCode: "1.0",
  modelVersion: "SignalK",
  modelSerialCode: "123456",
  certificationLevel: 0,
  loadEquivalency: 1
}


const n2kMessages = Bacon.fromEvent(readline.createInterface({input: process.stdin}), 'line')
  .map(JSON.parse)

const socketcanWriter = require('child_process').spawn('sh', ['-c', 'socketcan-writer can0'])


registerPgnHandler(59904, handleISORequest)
registerPgnHandler(126208, handleGroupFunction)

sendAddressClaim()


function registerPgnHandler(pgnNumber, handler) {
  n2kMessages
    .filter(m => m.pgn == pgnNumber && (m.dst == 255 || m.dst == ownAddr))
    .onValue(handler)
}


function handleISORequest(n2kMsg) {
  switch (n2kMsg.fields.PGN) {
    case 126996:  // Product Information request
      sendProductInformation()
      break;
    case 60928:   // ISO address claim request
      sendAddressClaim()
      break;
    default:
      console.log(`Got unsupported ISO request for PGN ${n2kMsg.fields.PGN}. Sending NAK.`)
      sendNAKAcknowledgement(n2kMsg.src, n2kMsg.fields.PGN)
  }
}

function handleGroupFunction(n2kMsg) {
  if(n2kMsg.fields["Function Code"] === 'Request') {
    handleRequestGroupFunction(n2kMsg)
  } else if(n2kMsg.fields["Function Code"] === 'Command') {
    handleCommandGroupFunction(n2kMsg)
  } else {
    console.log('Got unsupported Group Function PGN:', JSON.stringify(n2kMsg))
  }

  function handleRequestGroupFunction(n2kMsg) {
    // We really don't support group function requests for any PGNs yet -> always respond with pgnErrorCode 1 = "PGN not supported"
    console.log("Sending 'PGN Not Supported' Group Function response for requested PGN", n2kMsg.fields.PGN)
    sendPGN(createAcknowledgeGroupFunctionPGN({src: ownAddr, dst: n2kMsg.src, commandedPgn: n2kMsg.fields.PGN, pgnErrorCode: 1, transmissionOrPriorityErrorCode: 0}))
  }

  function handleCommandGroupFunction(n2kMsg) {
    // We really don't support group function commands for any PGNs yet -> always respond with pgnErrorCode 1 = "PGN not supported"
    console.log("Sending 'PGN Not Supported' Group Function response for commanded PGN", n2kMsg.fields.PGN)
    sendPGN(createAcknowledgeGroupFunctionPGN({src: ownAddr, dst: n2kMsg.src, commandedPgn: n2kMsg.fields.PGN, pgnErrorCode: 1, transmissionOrPriorityErrorCode: 0}))
  }
}

function sendProductInformation() {
  console.log("Sending product info..")
  sendPGN(createProductInformationPGN(productInfo))
}

function sendAddressClaim() {
  console.log("Sending address claim..")
  sendPGN(createISOAddressClaimPGN(addressClaim))
}

function sendNAKAcknowledgement(dst, pgn) {
  console.log("Sending NAK acknowledgement for PGN", pgn, "to", dst)
  sendPGN(createISOAcknowledgementPGN({src: ownAddr, dst, control: 1, groupFunction: 255, pgn}))
}


function sendPGN(fastFormatPgn) { socketcanWriter.stdin.write(fastFormatPgn + '\n') }


function createISOAddressClaimPGN({src, dst, uniqueNumber, manufacturerCode, deviceFunction, deviceClass, deviceInstanceLower, deviceInstanceUpper, systemInstance, industryGroup}) {
  const fmt = `${moment().utc().format(timestampFmt)},6,60928,${src},${dst},8,`
  const data = concentrate()
    .int32(uniqueNumber & 0x1FFFFF | (manufacturerCode & 0x7FF) << 21)
    .uint8(deviceInstanceLower & 0x7 | (deviceInstanceUpper & 0x1F) << 3)
    .uint8(deviceFunction)
    .uint8((deviceClass & 0x7f) << 1)
    .uint8((0x80 | ((industryGroup & 0x7) << 4) | (systemInstance & 0x0f)))
    .result()

  return fmt + R.splitEvery(2, data.toString('hex')).join(',')
}


function createProductInformationPGN({src, dst, n2kVersion, productCode, modelId, swCode, modelVersion, modelSerialCode, certificationLevel, loadEquivalency}) {
  const fmt = `${moment().utc().format(timestampFmt)},6,126996,${src},${dst},134,`
  const data = concentrate()
    .int16(n2kVersion)
    .int16(productCode)
    .buffer(strBuf(modelId, 32))
    .buffer(strBuf(swCode, 32))
    .buffer(strBuf(modelVersion, 32))
    .buffer(strBuf(modelSerialCode, 32))
    .uint8(certificationLevel)
    .uint8(loadEquivalency)
    .result()

  return fmt + R.splitEvery(2, data.toString('hex')).join(',')
}

function createISOAcknowledgementPGN({src, dst, control, groupFunction, pgn}) {
  const fmt = `${moment().utc().format(timestampFmt)},6,59392,${src},${dst},8,`
  const data = concentrate()
    .uint8(control)
    .uint8(groupFunction)
    .uint8(255)
    .uint8(255)
    .uint8(255)
    .uint8(pgn & 0xFF)
    .uint8(pgn >> 8 & 0xFF)
    .uint8(pgn >> 16 & 0xFF)
    .result()

  return fmt + R.splitEvery(2, data.toString('hex')).join(',')
}

function createAcknowledgeGroupFunctionPGN({src, dst, commandedPgn, pgnErrorCode, transmissionOrPriorityErrorCode}) {
  const fmt = `${moment().utc().format(timestampFmt)},3,126208,${src},${dst},8,00,06,02,`
  const data = concentrate()
    .uint8(commandedPgn & 0xFF)
    .uint8(commandedPgn >> 8 & 0xFF)
    .uint8(commandedPgn >> 16 & 0xFF)
    .uint8(pgnErrorCode | transmissionOrPriorityErrorCode << 4)
    .uint8(0)  // Always assume 0 parameters
    .result()

  return fmt + R.splitEvery(2, data.toString('hex')).join(',')
}

function strBuf(str, bufLength) {
  const buf = Buffer.alloc(bufLength)
  buf.write(str, 'ascii')
  return buf
}



//console.log(createISOAddressClaimPGN(addressClaim))
//console.log(createProductInformationPGN(productInfo))
//console.log(createAcknowledgeGroupFunctionPGN({src: 204, dst: 3, commandedPgn: 130817, pgnErrorCode: 1, transmissionOrPriorityErrorCode: 0}))

