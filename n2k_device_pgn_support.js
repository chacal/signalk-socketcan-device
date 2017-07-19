const R = require('ramda')
const concentrate = require('concentrate')
const uint64 = require('cuint').UINT64
const moment = require('moment')

const timestampFmt = "YYYY-MM-DD-HH:mm:ss.SSS"


const addressClaim = ownAddress => ({
  src: ownAddress,
  dst: 255,
  uniqueNumber: 1,
  manufacturerCode: 2000,   // Made up, not recognized by standard products
  deviceFunction: 130,      // PC gateway
  deviceClass: 25,          // Inter/Intranetwork Device
  deviceInstanceLower: 0,
  deviceInstanceUpper: 0,
  systemInstance: 0,
  industryGroup: 4          // Marine
})

const productInfo = ownAddress => ({
  src: ownAddress,
  dst: 255,
  n2kVersion: 1300,
  productCode: 666,   // Just made up..
  modelId: "SignalK Socketcan N2k Device",
  swCode: "1.0",
  modelVersion: "SignalK",
  modelSerialCode: "123456",
  certificationLevel: 0,
  loadEquivalency: 1
})



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

function getISOAddressClaimAsUint64({uniqueNumber, manufacturerCode, deviceFunction, deviceClass, deviceInstanceLower, deviceInstanceUpper, systemInstance, industryGroup}) {
  // Interpret all 8 data bytes as single uint64
  return uint64(uniqueNumber)
    .add(uint64(manufacturerCode).shiftLeft(21))
    .add(uint64(deviceInstanceLower).shiftLeft(32))
    .add(uint64(deviceInstanceUpper).shiftLeft(35))
    .add(uint64(deviceFunction).shiftLeft(40))
    .add(uint64(deviceClass).shiftLeft(49))
    .add(uint64(systemInstance).shiftLeft(56))
    .add(uint64(industryGroup).shiftLeft(60))
    .add(uint64(1).shiftLeft(63))
}


function strBuf(str, bufLength) {
  const buf = Buffer.alloc(bufLength)
  buf.write(str, 'ascii')
  return buf
}


module.exports = {
  addressClaim,
  productInfo,
  createISOAddressClaimPGN,
  createProductInformationPGN,
  createISOAcknowledgementPGN,
  createAcknowledgeGroupFunctionPGN,
  getISOAddressClaimAsUint64
}
