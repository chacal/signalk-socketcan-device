const Transform = require('stream').Transform
const Bacon = require('baconjs')
const debug = require('debug')('signalk-socketcan-device')
const PgnSupport = require('./n2k_device_pgn_support')

const n2kMessages = new Bacon.Bus()
let socketcanWriter
let ownAddr

//
// Constructor & message forwarding
//
function SignalKSocketcanDevice(options) {
  debug(`Starting signalk-socketcan-device with options ${JSON.stringify(options)}..`)
  Transform.call(this, { objectMode: true })

  const canDevice = options.canDevice || 'can0'
  socketcanWriter = options.useDummySocketcanWriter ? dummySocketcanWriter() : require('child_process').spawn('sh', ['-c', `socketcan-writer ${canDevice}`])

  ownAddr = options.n2kAddress || 100
  startDevice()
}

require('util').inherits(SignalKSocketcanDevice, Transform)

SignalKSocketcanDevice.prototype._transform = function(chunk, encoding, done) {
  n2kMessages.push(chunk)    // Push to our own event stream ..
  this.push(chunk)           // .. and pass through everything we get
  done()
}



//
// N2k device main logic
//
function startDevice() {
  registerPgnHandler(59904, handleISORequest)
  registerPgnHandler(126208, handleGroupFunction)
  registerPgnHandler(60928, handleISOAddressClaim)

  sendAddressClaim()
}



//
// N2k device message handlers
//
function handleISORequest(n2kMsg) {
  switch (n2kMsg.fields.PGN) {
    case 126996:  // Product Information request
      sendProductInformation()
      break;
    case 60928:   // ISO address claim request
      sendAddressClaim()
      break;
    default:
      debug(`Got unsupported ISO request for PGN ${n2kMsg.fields.PGN}. Sending NAK.`)
      sendNAKAcknowledgement(n2kMsg.src, n2kMsg.fields.PGN)
  }
}

function handleGroupFunction(n2kMsg) {
  if(n2kMsg.fields["Function Code"] === 'Request') {
    handleRequestGroupFunction(n2kMsg)
  } else if(n2kMsg.fields["Function Code"] === 'Command') {
    handleCommandGroupFunction(n2kMsg)
  } else {
    debug('Got unsupported Group Function PGN:', JSON.stringify(n2kMsg))
  }

  function handleRequestGroupFunction(n2kMsg) {
    // We really don't support group function requests for any PGNs yet -> always respond with pgnErrorCode 1 = "PGN not supported"
    debug("Sending 'PGN Not Supported' Group Function response for requested PGN", n2kMsg.fields.PGN)
    sendPGN(PgnSupport.createAcknowledgeGroupFunctionPGN({src: ownAddr, dst: n2kMsg.src, commandedPgn: n2kMsg.fields.PGN, pgnErrorCode: 1, transmissionOrPriorityErrorCode: 0}))
  }

  function handleCommandGroupFunction(n2kMsg) {
    // We really don't support group function commands for any PGNs yet -> always respond with pgnErrorCode 1 = "PGN not supported"
    debug("Sending 'PGN Not Supported' Group Function response for commanded PGN", n2kMsg.fields.PGN)
    sendPGN(PgnSupport.createAcknowledgeGroupFunctionPGN({src: ownAddr, dst: n2kMsg.src, commandedPgn: n2kMsg.fields.PGN, pgnErrorCode: 1, transmissionOrPriorityErrorCode: 0}))
  }
}

function handleISOAddressClaim(n2kMsg) {
  debug('Checking ISO address claim. Source:', n2kMsg.src)

  const uint64ValueFromReceivedClaim = PgnSupport.getISOAddressClaimAsUint64({
    uniqueNumber: n2kMsg.fields["Unique Number"],
    manufacturerCode: n2kMsg.fields["Manufacturer Code"],
    deviceFunction: n2kMsg.fields["Device Function"],
    deviceClass: n2kMsg.fields["Device Class"],
    deviceInstanceLower: n2kMsg.fields["Device Instance Lower"],
    deviceInstanceUpper: n2kMsg.fields["Device Instance Upper"],
    systemInstance: n2kMsg.fields["System Instance"],
    industryGroup: n2kMsg.fields["Industry Group"]
  })
  const uint64ValueFromOurOwnClaim = PgnSupport.getISOAddressClaimAsUint64(PgnSupport.addressClaim(ownAddr))

  if(uint64ValueFromOurOwnClaim.lt(uint64ValueFromReceivedClaim)) {
    sendAddressClaim()      // We have smaller address claim data -> we can keep our address -> re-claim it
    debug(`Address conflict detected! Kept our address as ${ownAddr}.`)
  } else if(uint64ValueFromOurOwnClaim.gt(uint64ValueFromReceivedClaim)) {
    increaseOwnAddress()    // We have bigger address claim data -> we have to change our address
    sendAddressClaim()
    debug(`Address conflict detected! Changed our address to ${ownAddr}.`)
  } else {
    // Address claim data is exactly the same than we have -> assume it was sent by ourselves -> do nothing
  }

  function increaseOwnAddress() {
    ownAddr = (ownAddr + 1) % 253
  }
}



//
// Helpers
//
function sendProductInformation() {
  debug("Sending product info..")
  sendPGN(PgnSupport.createProductInformationPGN(PgnSupport.productInfo(ownAddr)))
}

function sendAddressClaim() {
  debug("Sending address claim..")
  sendPGN(PgnSupport.createISOAddressClaimPGN(PgnSupport.addressClaim(ownAddr)))
}

function sendNAKAcknowledgement(dst, pgn) {
  debug("Sending NAK acknowledgement for PGN", pgn, "to", dst)
  sendPGN(PgnSupport.createISOAcknowledgementPGN({src: ownAddr, dst, control: 1, groupFunction: 255, pgn}))
}

function sendPGN(fastFormatPgn) { socketcanWriter.stdin.write(fastFormatPgn + '\n') }

function registerPgnHandler(pgnNumber, handler) {
  n2kMessages
    .filter(m => m.pgn == pgnNumber && (m.dst == 255 || m.dst == ownAddr))
    .onValue(handler)
}

function dummySocketcanWriter() {
  return {
    stdin: {
      write: data => debug('CAN TX:', data)
    }
  }
}



module.exports = SignalKSocketcanDevice
