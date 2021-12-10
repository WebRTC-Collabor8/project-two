const VIDEO_CHAT = 'videoChat';
const TEXT_CHAT = 'textChat';
const VIDEO_CONTROL = 'videoControl';

const $self = {
  /* common start */
  rtcConfig: {
    iceServers: [{
      urls: "stun:stun.l.google.com:19302"
    }]
  },
  id: null,
  // name should be set when creating or joining the party
  // call sessionStorage.setItem('name', 'Test') in the console for direct testing
  name: sessionStorage.getItem('name'),

  userMediaPromise: null,

  // computed property names
  [VIDEO_CHAT]: {
    // [peerId]: { isPolit, ... }
  },
  [TEXT_CHAT]: {
    // [peerId]: { isPolit, ... }
  },
  [VIDEO_CONTROL]: {
    // [peerId]: { isPolit, ... }
  },
  /* common end */

  /* David start */
  mediaConstraints: { audio: false, video: true },

  /* David end */

  /*  Michael start */
  controlTextId: 88,
  /*  Michael end */

  /* Chiachi start */
  controlDCId: 99,
  // videoId should be set when creating party
  // call sessionStorage.setItem('videoId', '9-14W5Q1sfk') in the console for direct testing
  videoId: sessionStorage.getItem('videoId'),
  player: null,
  playerState: null,
  /* Chiachi end */
};

// For storing user video peers
const $peers = {
  names: {},
  [VIDEO_CHAT]: {
    // [peerId]: { connection, ... }
  },
  [TEXT_CHAT]: {
    // [peerId]: { connection, ... }
  },
  [VIDEO_CONTROL]: {
    // [peerId]: { connection, ... }
  },
};

// For users who enter the room via the copied link
if (!$self.name) {
  const urName = prompt("Please enter a name:");
  sessionStorage.setItem('name', urName);
  $self.name = urName
}

/*
First page forms
*/

/** Signaling-Channel Setup **/
const namespace = prepareNamespace(window.location.hash, true);

document.querySelector('#roomID').innerText = ('Room ID: ' + namespace);

let scPath = `/${namespace}?name=${encodeURIComponent($self.name)}`
if ($self.videoId) {
  scPath += `&videoId=${encodeURIComponent($self.videoId)}`
}
const sc = io.connect(scPath, { autoConnect: false });

registerChannelEvents();

$self.userMediaPromise = requestUserMedia($self.mediaConstraints);
sc.open();

// Signaling Channel Events
function registerChannelEvents() {
  sc.on('connect', handleChannelConnect);
  sc.on('connected peers', handleChannelConnectedPeers);
  sc.on('connected peer', handleChannelConnectedPeer);
  sc.on('signal', handleChannelSignal);
  sc.on('disconnected peer', handleChannelDisconnectedPeer);
}

function handleChannelConnect() {
  console.log('Connected to signaling server!');
  $self.id = sc.id;
  console.log(`Self ID: ${$self.id}`);
}

function handleChannelConnectedPeers({ peers, videoId }) {
  if (!$self.videoId) {
    $self.videoId = videoId;
  } else {
    // Host has video id from beginning
    // Add the End the party button (host only feature)
    const endButton = document.createElement('a');
    endButton.innerText = 'End the party';
    endButton.className = 'button';
    const container = document.querySelector('#nav-tool');
    container.appendChild(endButton);
    endButton.addEventListener('click', (e) => {
      e.preventDefault();
      const answer = confirm("Do you want to end the party for all!?");
      if (answer) {
        sc.emit('signal', {
          from: $self.id,
          end: true
        });
        // clean up vidoe id in session storage
        sessionStorage.removeItem('videoId');
        location.href = '/';
      }
    });
  }
  console.log(`Vdieo ID: ${$self.videoId}`);
  initYouTubeIframeAPI();

  for (let { id, name } of peers) {
    if (id !== $self.id) {
      console.log(`Connected peers ${id} - ${name}`);
      $peers.names[id] = name;

      // $self is polite with already-connected peers
      initializeSelfAndPeerByIdAndType(VIDEO_CHAT, id, true);
      establishCallFeatures(id);

      initializeSelfAndPeerByIdAndType(TEXT_CHAT, id, true);
      establishTextChatFeatures(id);

      initializeSelfAndPeerByIdAndType(VIDEO_CONTROL, id, true);
      establishVideoControlFeatures(id);
    }
  }
}

function handleChannelConnectedPeer({ id, name }) {
  console.log(`The new coming peer: ${id} - ${name}`);
  $peers.names[id] = name;

  // $self is impolite with each newly connecting peer
  initializeSelfAndPeerByIdAndType(VIDEO_CHAT, id, false);
  establishCallFeatures(id);

  initializeSelfAndPeerByIdAndType(TEXT_CHAT, id, false);
  establishTextChatFeatures(id);

  initializeSelfAndPeerByIdAndType(VIDEO_CONTROL, id, false);
  establishVideoControlFeatures(id);
}

function initializeSelfAndPeerByIdAndType(type, id, politeness) {
  $self[type][id] = {
    isPolite: politeness,
    isMakingOffer: false,
    isIgnoringOffer: false,
    isSettingRemoteAnswerPending: false
  };
  $peers[type][id] = { connection: new RTCPeerConnection($self.rtcConfig) };
}

function handleChannelDisconnectedPeer(id) {
  console.log(`Disconnected peer ID: ${id}`);
}

async function handleChannelSignal({ from, to, type, description, candidate, resend, end }) {
  console.log('Heard signal event!');
  let myself = null;
  let peer = null;
  if (type) {
    myself = $self[type][from];
    peer = $peers[type][from];
  }

  if (description) {
    console.log('Received SDP Signal:', description);
    const readyForOffer = !myself.isMakingOffer &&
        (peer.connection.signalingState === 'stable' || myself.isSettingRemoteAnswerPending);
    console.log('readyForOffer:', readyForOffer);

    const offerCollision = description.type === 'offer' && !readyForOffer;
    console.log('offerCollision:', offerCollision);

    myself.isIgnoringOffer = !myself.isPolite && offerCollision;
    console.log('isIgnoringOffer:', myself.isIgnoringOffer);

    if (myself.isIgnoringOffer) {
      return;
    }

    myself.isSettingRemoteAnswerPending = description.type === 'answer';
    try {
      await peer.connection.setRemoteDescription(description);
    } catch(e) {
      console.error('Cannot set remote description', e);
      if (!myself.isSettingRemoteAnswerPending && peer.connection.signalingState === 'have-local-offer') {
        // the browser (Safari) can't handle state conflict, so reset myself and tell remote end to send again
        resetConnection(type, from);
      }
      return;
    }
    myself.isSettingRemoteAnswerPending = false;

    if (description.type === 'offer') {
      try {
        await peer.connection.setLocalDescription();
      } catch(e) {
        const answer = await peer.connection.createAnswer();
        await peer.connection.setLocalDescription(answer);
      } finally {
        console.log('Send answer');
        sc.emit('signal', {
          from: $self.id,
          to: from,
          type,
          description: peer.connection.localDescription
        });
        myself.skipOffer = false;
      }
    }
  } else if (candidate) {
    console.log('Received ICE candidate:', candidate);
    try {
      await peer.connection.addIceCandidate(candidate);
    } catch(e) {
      if (!myself.isIgnoringOffer) {
        console.error('Cannot add ICE candidate for peer', e);
      }
    }
  } else if (resend) {
    console.log('Received resend signal');
    handleRtcNegotiation(type, from);
  } else if (end) {
    alert(`The host ${$peers.names[from]} has ended the party!`);
    location.href = '/';
  }
}

/* WebRTC Events */
function registerRtcEvents(type, id, handler) {
  const peer = $peers[type][id];

  peer.connection.onnegotiationneeded = () => handleRtcNegotiation(type, id);
  peer.connection.onicecandidate = ({ candidate }) => handleIceCandidate(type, id, candidate);

  if (type === VIDEO_CHAT) {
    peer.connection.ontrack = handleRtcPeerTrack(id);
  } else {
    // The rest of types are data channel event
    peer.connection.ondatachannel = ({ channel }) => handler(type, id, channel);
  }
}

async function handleRtcNegotiation(type, id) {
  const myself = $self[type][id];
  const peer = $peers[type][id];
  console.log('RTC negotiation needed...');
  if (myself.skipOffer) {
    console.log('Skip offer');
    return;
  }
  // send an SDP description
  myself.isMakingOffer = true;
  try {
    await peer.connection.setLocalDescription();
  } catch (e) {
    const offer = await peer.connection.createOffer();
    await peer.connection.setLocalDescription(offer);
  } finally {
    // finally, however this was done, send the localDescription to the remote peer
    console.log('Send description...');
    sc.emit('signal', {
      from: $self.id,
      to: id,
      type,
      description: peer.connection.localDescription
    });
  }
  myself.isMakingOffer = false;
}

function handleIceCandidate(type, id, candidate) {
  // send ICE candidate
  console.log('Send ICE candidate...');
  sc.emit('signal', {
    from: $self.id,
    to: id,
    type,
    candidate
  });
}

function resetConnection(type, id) {
  const myself = $self[type][id];
  const peer = $peers[type][id];
  peer.connection.close();
  myself.skipOffer = true;

  switch(type) {
    case VIDEO_CHAT:
      initializeSelfAndPeerByIdAndType(VIDEO_CHAT, id, true);
      establishCallFeatures(id);
      break;
    case TEXT_CHAT:
      initializeSelfAndPeerByIdAndType(TEXT_CHAT, id, true);
      establishTextChatFeatures(id);
      break;
    case VIDEO_CONTROL:
      initializeSelfAndPeerByIdAndType(VIDEO_CONTROL, id, true);
      establishVideoControlFeatures(id);peer.connection = new RTCPeerConnection($self.rtcConfig);
      break;
  }

  sc.emit('signal', { from: $self.id, to: id, type, resend: true });
}

function handleRtcPeerTrack(id) {
  return function({ track, streams: [stream] }) {
  console.log('Attempt to display peer media...');
  displayStream(id , stream);
  }
}

//possible need for handleRtcConnectionStateChange

/**
David start
*/

async function requestUserMedia(media_constraints) {
  $self.stream = new MediaStream();
  $self.media = await navigator.mediaDevices
    .getUserMedia(media_constraints);
  $self.stream.addTrack($self.media.getTracks()[0]);
  displayStream('self', $self.stream);
}

function createVideoElement(id) {
  const figure = document.createElement('figure');
  const figcaption = document.createElement('figcaption');
  const video = document.createElement('video');
  const video_attributes = {
    'autoplay': '',
    'playsinline': '',
    'poster': '../images/placeholder.jpg'
  };

  figure.id = `video-${id}`;
  figcaption.innerText = $peers.names[id];
  for (let attr in video_attributes){
    video.setAttribute(attr, video_attributes[attr]);
  }
  figure.appendChild(video);
  figure.appendChild(figcaption);
  return figure;
}

function displayStream(id, stream) {
  let video_element = document.querySelector(`#video-${id}`);
  if (!video_element) {
    console.log('creating new peer ID...');
    video_element = createVideoElement(id);
  }
  let video = video_element.querySelector('video');
  video.srcObject = stream;
  document.querySelector('#userVideos').appendChild(video_element);
}

function establishCallFeatures(id) {
  registerRtcEvents(VIDEO_CHAT, id, videoChatOnTrack);
  $self.userMediaPromise.then(() => {
    addStreamingMedia(id, $self.stream);
  });
}

function videoChatOnTrack(type, id, stream) {
  console.log('handle video chat ontrack');
}

function addStreamingMedia(id, stream) {
  const peer = $peers[VIDEO_CHAT][id];
  if (stream) {
    for (let track of stream.getTracks()) {
      peer.connection.addTrack(track, stream);
    }
  }
}
/**
David end
*/



/**
Michael start
*/
function establishTextChatFeatures(id) {
  registerRtcEvents(TEXT_CHAT, id, textChatOnDataChannel);
  const peer = $peers[TEXT_CHAT][id];
  peer.dataChannel = peer.connection.createDataChannel(TEXT_CHAT, {
    negotiated: true,
    id: $self.controlTextId,
  });
  peer.dataChannel.onmessage = handleTextMessage;
}

function textChatOnDataChannel(type, id, channel) {
  console.log('handle text chat ondatachannel');
}

const chatform = document.querySelector('#data');
  chatform.addEventListener('submit', handleTextChat);

  function handleTextMessage({data}) {
      const { from, message } = JSON.parse(data);
      console.log('Message: ', message);
      const log = document.querySelector('#chat-log');
      const sender = document.createElement('li');
      sender.innerText = $peers.names[from] + ':';
      sender.className = 'usernameclass';
      log.appendChild(sender);
      const li = document.createElement('li');
      li.innerText = message;
      li.className = 'undefined';
      log.appendChild(li);
   }

  function handleTextChat(e) {
    e.preventDefault();
    const form = e.target;
    const input = form.querySelector('#message');
    const username = sessionStorage.getItem('name');
    const message = input.value;

    appendUsername('peer', username,);
    for(let peerID in $peers[TEXT_CHAT]) {
      console.log('Username Displaying To: ', peerID);
      $peers[TEXT_CHAT][peerID].dataChannel.send(JSON.stringify({ from: $self.id, message }));
    }

    appendMessage('self', message,);
    for(let peerID in $peers[TEXT_CHAT]) {
      console.log('Sending message to:', peerID);
      $peers[TEXT_CHAT][peerID].dataChannel.send(message);
    }

    console.log('Message sent by: ', username);
    console.log('Message:', message);
    input.value = '';
  }

function appendMessage (sender, message) {
  const log = document.querySelector('#chat-log');
  const li = document.createElement('li');
  li.innerText = message;
  li.className = sender;
  log.appendChild(li);
}

function appendUsername (peer, username) {
  const userlog = document.querySelector('#chat-log');
  const userli = document.createElement('li');
  userli.innerText = username + ':';
  userli.className = peer;
  userlog.appendChild(userli);
}

/**
Michael end
*/



/**
Chiachi start
*/
// TODO get vidoe id from the room settings
function establishVideoControlFeatures(id) {
  registerRtcEvents(VIDEO_CONTROL, id, videoControlOnDataChannel);
  const peer = $peers[VIDEO_CONTROL][id];
  peer.dataChannel = peer.connection.createDataChannel(VIDEO_CONTROL, {
    negotiated: true,
    id: $self.controlDCId,
  });
  peer.dataChannel.onmessage = handleVideoControl;
}

function videoControlOnDataChannel(type, id, channel) {
  console.log('handle video control ondatachannel', type, id, channel);
}


function initYouTubeIframeAPI() {
  const iframeAPIScript = document.createElement('script');
  iframeAPIScript.src = 'https://www.youtube.com/iframe_api';
  document.getElementsByTagName('body')[0].append(iframeAPIScript);
}

const playerDom = document.getElementById('player');

// This will be executed after the YouTubeIframeAPI is loaded.
function onYouTubeIframeAPIReady() {
  $self.player = new YT.Player('player', {
    height: playerDom.clientWidth * 0.5625,
    width: playerDom.clientWidth,
    videoId: $self.videoId,
    playerVars: {
      modestbranding: 1,
      controls: 0,
      playsinline: 1
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange
    }
  });
}

// This will be called when the video player is ready.
function onPlayerReady(event) {
  console.log('Player ready...');
  // Mute to prevent this error "Autoplay is only allowed when approved by the user, the site is activated by the user, or media is muted."
  $self.player.mute();
  $self.playerState = $self.player.getPlayerState();
}

// The will be called when the player's state changes.
function onPlayerStateChange(event) {
  switch(event.data) {
    case YT.PlayerState.PLAYING:
      if ($self.playerState !== event.data) {
        startVideo(event);
      }
      break;
    case YT.PlayerState.PAUSED:
      if ($self.playerState !== event.data) {
        pauseVideo(event);
      }
      break;

    case YT.PlayerState.CUED:
      if ($self.playerState !== event.data) {
        stop(event);
      }
      break;
  }
}

function startVideo(event) {
  if ($self.playerState === YT.PlayerState.PLAYING) {
    return;
  }
  if (event) {
    // command initiate from the user so send the command to everyone
    sendControlCommand('start');
  }
  $self.player.playVideo();
  $self.playerState = YT.PlayerState.PLAYING;
}

function pauseVideo(event) {
  if ($self.playerState === YT.PlayerState.PAUSED) {
    return;
  }

  if (event) {
    // command initiate from the user so send the command to everyone
    sendControlCommand('pause');
  }
  $self.player.pauseVideo();
  $self.playerState = YT.PlayerState.PAUSED;
}

function stopVideo(event) {
  if ($self.playerState === YT.PlayerState.CUED) {
    return;
  }

  if (event) {
    // command initiate from the user so send the command to everyone
    sendControlCommand('stop');
  }
  $self.player.stopVideo();
  $self.playerState = YT.PlayerState.CUED;
}

function toggleVolume(event) {
  const icon = event.currentTarget.querySelector('.fas');
  if (icon.classList.contains('fa-volume-mute')) {
    icon.classList.remove('fa-volume-mute');
    icon.classList.add('fa-volume-up');
    $self.player.unMute();
  } else {
    icon.classList.remove('fa-volume-up');
    icon.classList.add('fa-volume-mute');
    $self.player.mute();
  }
}

function sendControlCommand(command) {
  for(let peerID in $peers[VIDEO_CONTROL]) {
    console.log('send command to', peerID);
    $peers[VIDEO_CONTROL][peerID].dataChannel.send(JSON.stringify({ from: $self.id, command }));
  }
}

function handleVideoControl({ data }) {
  const { from, command } = JSON.parse(data);
  createBubbleMsg(document.querySelector('#video'), `${$peers.names[from]} ${command}s the video`, 'control-bubble', 8000);
  switch(command) {
    case 'start':
      startVideo();
      break;
    case 'pause':
      pauseVideo();
      break;
    case 'stop':
      stopVideo();
      break;
    default:
      console.log('unknown command');
  }
}

function copyLink(e){
  e.preventDefault();
  const tempText = document.createElement('textarea');
  tempText.innerHTML = location.href;
  document.body.appendChild(tempText);
  tempText.select();
  document.execCommand('copy');
  tempText.remove();
  createBubbleMsg(e.currentTarget, 'copied', 'copied', 5000);
}

function createBubbleMsg(container, text, className, time) {
  const bubble = document.createElement('span');
  bubble.className = className;
  bubble.innerText = text;
  container.appendChild(bubble);
  setTimeout(() => {
    bubble.remove();
  }, time);
}

document.getElementById('play-video').addEventListener('click', startVideo);
document.getElementById('pause-video').addEventListener('click', pauseVideo);
document.getElementById('stop-video').addEventListener('click', stopVideo);
document.getElementById('toggle-video-sound').addEventListener('click', toggleVolume);
document.getElementById('copy-link').addEventListener('click', copyLink);

/**
Chiachi end
*/
