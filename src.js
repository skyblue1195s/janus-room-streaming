const Janus = window.Janus = require('./janus');
const volumeMeter = require('volume-meter-skip');


window.AudioContext = window.AudioContext || window.webkitAudioContext;

var config = {
  remotestreams: {},
  feeds: [],
  bitrateTimer: []
}
var stream, recorder;

window.remotestreams = config.remotestreams;

// TODO Remove unused events / functions

// Helpers
function getQueryStringValue(name) {
  name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
  var regex = new RegExp("[\\?&]" + name + "=([^&#]*)");
  var results = regex.exec(window.location.search);
  return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
}

function publishOwnFeed(opts, cb) {
  opts = opts || {}
  // Publish our stream
  config.isShareScreenActive = false;
  config.videoRoomHandler.createOffer({
    // Add data:true here if you want to publish datachannels as well
    media: {
      audioRecv: false,
      videoRecv: false,
      audioSend: opts.audioSend,
      replaceAudio: opts.replaceAudio,
      videoSend: Janus.webRTCAdapter.browserDetails.browser === 'safari' ? false : opts.videoSend,
      replaceVideo: opts.replaceVideo,
      data: true,
    }, // Publishers are sendonly
    simulcast: doSimulcast,
    success: function (jsep) {
      Janus.debug("Got publisher SDP!");
      Janus.debug(jsep);
      var publish = {
        "request": "configure",
        "audio": opts.audioSend,
        "video": Janus.webRTCAdapter.browserDetails.browser === 'safari' ? false : true,
        "data": true,
      };
      if (config.token) publish.token = config.token;
      config.videoRoomHandler.send({
        "message": publish,
        "jsep": jsep
      });
      if (cb) {
        cb();
      }
    },
    error: function (error) {
      Janus.error("WebRTC error:", error);
      if (opts && opts.audioSend) {
        publishOwnFeed({
          audioSend: false
        });
      } else {
        config.onError("WebRTC error... " + JSON.stringify(error));
      }
    }
  });
}


// Unpublish our stream
function unpublishOwnFeed() {
  return new Promise((resolve, reject) => {
    var unpublish = {
      "request": "unpublish",
    };
    if (config.token) unpublish.token = config.token;
    config.videoRoomHandler.send({
      "message": unpublish,
      success: function () {
        resolve();
      },
      error: function (err) {
        // // reject(err);
      }
    });
  });
}

function shareScreen(cb) {
  // Publish our stream
  config.videoRoomHandler.createOffer({
    // Add data:true here if you want to publish datachannels as well
    media: {
      video: 'screen',
      videoRecv: false,
      audioSend: true,
      videoSend: true,
      captureDesktopAudio: true,
      data: true,
    }, // Publishers are sendonly
    success: function (jsep) {
      Janus.debug("Got publisher SDP!");
      Janus.debug(jsep);
      var publish = {
        "request": "configure",
        "audio": true,
        "video": true,
        "data": true
      };
      if (config.token) publish.token = config.token;
      config.isShareScreenActive = true;
      config.videoRoomHandler.send({
        "message": publish,
        "jsep": jsep
      });
    },
    error: function (error) {
      Janus.error("WebRTC error:", error);
      if (cb) {
        cb(error);
      }
    }
  });
}

function startRecording(options) {
  config.recordPlayHandler.send({
    'message': {
      'request': 'configure',
      'video-bitrate-max': 1024 * 1024, // a quarter megabit
      'video-keyframe-interval': 15000 // 15 seconds
    }
  });
  config.recordPlayHandler.createOffer({
    // By default, it's sendrecv for audio and video... no datachannels
    // If you want to test simulcasting (Chrome and Firefox only), then
    // pass a ?simulcast=true when opening this demo page: it will turn
    // the following 'simulcast' property to pass to janus.js to true
    simulcast: doSimulcast,
    success: function (jsep) {
      Janus.debug("Got SDP!");
      Janus.debug(jsep);
      var body = {
        "request": "record",
        "name": options.name || 'janus-room-test-' + (new Date()).valueOf(),
      };
      config.recordPlayHandler.send({
        "message": body,
        "jsep": jsep
      });
    },
    error: function (error) {
      Janus.error("WebRTC error...", error);
      bootbox.alert("WebRTC error... " + error);
      config.recordPlayHandler.hangup();
    }
  });
}

function stopPlayback() {
  return new Promise((resolve, reject) => {
    var stop = {
      "request": "stop",
    };
    config.recordPlayHandler.send({
      "message": stop,
      success: function () {
        resolve();
      },
      error: function (err) {
        // // reject(err);
      }
    });
  });
}

function start() {
  return new Promise((resolve, reject) => {
    try {
      // Make sure the browser supports WebRTC
      if (!Janus.isWebrtcSupported()) {
        config.onError("No WebRTC support... ");
        return;
      }
      // Create session
      config.janus = new Janus({
        server: config.server,
        token: config.token,
        pin: config.pin,
        success: function () {

          // Attach to video room plugin
          config.janus.attach({
            plugin: "janus.plugin.videoroom",
            opaqueId: config.opaqueId,
            success: function (pluginHandle) {
              config.videoRoomHandler = window.myfeed = pluginHandle;
              Janus.log("Plugin attached! (" + config.videoRoomHandler.getPlugin() + ", id=" + config.videoRoomHandler.getId() + ")");
              Janus.log("  -- This is a publisher/manager");
              resolve();
            },
            error: function (error) {
              Janus.error("  -- Error attaching plugin...", error);
              config.onError("Error attaching plugin... " + error);
            },
            consentDialog: function (on) {
              Janus.debug("Consent dialog should be " + (on ? "on" : "off") + " now");
              if (on) {
                // Darken screen and show hint
              } else {
                // Restore screen
              }
            },
            mediaState: function (medium, on) {
              Janus.log("Janus " + (on ? "started" : "stopped") + " receiving our " + medium);
              // FIXME Be aware, in Chrome, this on signal is not always true
            },
            webrtcState: function (on) {
              Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
            },
            onmessage: function (msg, jsep) {
              Janus.debug(" ::: Got a message (publisher) :::");
              Janus.debug(msg);
              Janus.debug(jsep);
              config.videoRoomHandler.alive = true;

              var event = msg["videoroom"];
              Janus.debug("Event: " + event);
              if (event != undefined && event != null) {
                if (event === "joined" && !config.isShareScreenActive) {
                  // Publisher/manager created, negotiate WebRTC and attach to existing feeds, if any
                  config.myid = msg["id"];
                  config.mypvtid = msg["private_id"];
                  Janus.log("Successfully joined room " + msg["room"] + " with ID " + config.myid);
                  if (config.publishOwnFeed) {
                    publishOwnFeed({
                      audioSend: true
                    });
                  }
                  // Any new feed to attach to?
                  if (msg["publishers"] !== undefined && msg["publishers"] !== null) {
                    var list = msg["publishers"];
                    Janus.debug("Got a list of available publishers/feeds:");
                    Janus.debug(list);
                    for (var f in list) {
                      var id = list[f]["id"];
                      var display = list[f]["display"];
                      var audio = list[f]["audio_codec"];
                      var video = list[f]["video_codec"];
                      Janus.debug("  >> [" + id + "] " + display + " (audio: " + audio + ", video: " + video + ")");
                      newRemoteFeed(id, display, audio, video);
                    }
                  }
                } else if (event === 'slow_link') {
                  if (result) {
                    var uplink = result["uplink"];
                    if (uplink !== 0) {
                      if (config.onWarning) config.onWarning(msg);
                      // Janus detected issues when receiving our media, let's slow down
                      if (!config.isShareScreenActive) {
                        let bandwidth = parseInt(bandwidth / 1.5);
                        config.recordPlayHandler.send({
                          'message': {
                            'request': 'configure',
                            'video-bitrate-max': bandwidth, // Reduce the bitrate
                            'video-keyframe-interval': 15000 // Keep the 15 seconds key frame interval
                          }
                        });
                      }
                    }
                  }
                } else if (event === "destroyed") {
                  // The room has been destroyed
                  Janus.warn("The room has been destroyed!");
                  config.onDestroyed();
                } else if (event === "event") {
                  // Any new feed to attach to?
                  if (msg["publishers"] !== undefined && msg["publishers"] !== null) {
                    var list = msg["publishers"];
                    Janus.debug("Got a list of available publishers/feeds:");
                    Janus.debug(list);
                    for (var f in list) {
                      var id = list[f]["id"];
                      var display = list[f]["display"];
                      var audio = list[f]["audio_codec"];
                      var video = list[f]["video_codec"];
                      Janus.debug("  >> [" + id + "] " + display + " (audio: " + audio + ", video: " + video + ")");
                      newRemoteFeed(id, display, audio, video);
                    }
                  } else if (msg["leaving"] !== undefined && msg["leaving"] !== null) {
                    // One of the publishers has gone away?
                    var leaving = msg["leaving"];
                    Janus.log("Publisher left: " + leaving);
                    var remoteFeed = null;
                    for (var i = 1; i < 6; i++) {
                      if (config.feeds[i] != null && config.feeds[i] != undefined && config.feeds[i].rfid == leaving) {
                        remoteFeed = config.feeds[i];
                        break;
                      }
                    }
                    if (remoteFeed != null) {
                      Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
                      config.feeds[remoteFeed.rfindex] = null;
                      remoteFeed.detach();
                    }
                  } else if (msg["unpublished"] !== undefined && msg["unpublished"] !== null) {
                    // One of the publishers has unpublished?
                    var unpublished = msg["unpublished"];
                    Janus.log("Publisher left: " + unpublished);
                    if (unpublished === 'ok') {
                      // That's us
                      config.videoRoomHandler.hangup();
                      return;
                    }
                    var remoteFeed = null;
                    for (var i = 1; i < 6; i++) {
                      if (config.feeds[i] != null && config.feeds[i] != undefined && config.feeds[i].rfid == unpublished) {
                        remoteFeed = config.feeds[i];
                        break;
                      }
                    }
                    if (remoteFeed != null) {
                      Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
                      config.feeds[remoteFeed.rfindex] = null;
                      remoteFeed.detach();
                    }
                  } else if (msg["error"] !== undefined && msg["error"] !== null) {
                    if (msg["error_code"] === 426) {
                      config.onError('The room is unavailable. Please create one.');
                    } else {
                      config.onError(msg["error"]);
                    }
                  }
                }
              }
              if (jsep !== undefined && jsep !== null) {
                Janus.debug("Handling SDP as well...");
                Janus.debug(jsep);
                config.videoRoomHandler.handleRemoteJsep({
                  jsep: jsep
                });
                // Check if any of the media we wanted to publish has
                // been rejected (e.g., wrong or unsupported codec)
                var audio = msg["audio_codec"];
                if (config.mystream && config.mystream.getAudioTracks() && config.mystream.getAudioTracks().length > 0 && !audio) {
                  // Audio has been rejected
                  Janus.debug("Our audio stream has been rejected, viewers won't hear us");
                }
                var video = msg["video_codec"];
                if (config.mystream && config.mystream.getVideoTracks() && config.mystream.getVideoTracks().length > 0 && !video) {
                  // Video has been rejected
                  Janus.debug("Our video stream has been rejected, viewers won't see us");
                  // Hide the webcam video
                }
              }
            },
            onlocalstream: function (stream) {
              Janus.debug(" ::: Got a local stream :::");
              config.mystream = window.mystream = stream; // attach to global for debugging purpose
              if (config.mystream.getVideoTracks().length > 0) {
                config.mystream.getVideoTracks()[0].onended = function () {
                  if (config.isShareScreenActive && config.publishOwnFeed) {
                    console.log('Put back the webcam');
                    publishOwnFeed({
                      audioSend: true,
                      videoSend: true,
                      replaceVideo: true,
                      replaceAudio: true,
                    });
                  }
                }
              }
              Janus.debug(stream);
              config.onLocalJoin();
              if (config.onVolumeMeterUpdate) {
                let ctx = new AudioContext();
                let meter = volumeMeter(ctx, {
                  tweenIn: 2,
                  tweenOut: 6,
                  skip: config.volumeMeterSkip
                }, (volume) => {
                  config.onVolumeMeterUpdate(0, volume);
                });
                let src = ctx.createMediaStreamSource(config.mystream);
                src.connect(meter);
                config.mystream.onended = meter.stop.bind(meter);
              }
            },
            onremotestream: function (stream) {
              // The publisher stream is sendonly, we don't expect anything here
            },
            ondataopen: function (data) {
              console.log('ondataopen');
            },
            oncleanup: function () {
              Janus.log(" ::: Got a cleanup notification: we are unpublished now :::");
              config.mystream = null;
            }
          });

          if (config.useRecordPlugin) {
            // Attach to config.recordPlayHandler plugin
            config.janus.attach({
              plugin: "janus.plugin.recordplay",
              opaqueId: config.opaqueId,
              success: function (pluginHandle) {
                config.recordPlayHandler = pluginHandle;
                Janus.log("Plugin attached! (" + config.recordPlayHandler.getPlugin() + ", id=" + config.recordPlayHandler.getId() + ")");
                // Now ready for recording. See startRecording()
              },
              error: function (error) {
                Janus.error("  -- Error attaching plugin...", error);
                onError(error)
              },
              consentDialog: function (on) {
                // Handle consentDialog
              },
              webrtcState: function (on) {
                Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
              },
              onmessage: function (msg, jsep) {
                Janus.debug(" ::: Got a message :::");
                Janus.debug(msg);
                config.videoRoomHandler.alive = true;
                var result = msg["result"];
                if (result !== null && result !== undefined) {
                  if (result["status"] !== undefined && result["status"] !== null) {
                    var event = result["status"];
                    if (event === 'preparing' || event === 'refreshing') {
                      Janus.log("Preparing the recording playout");
                      config.recordPlayHandler.createAnswer({
                        jsep: jsep,
                        media: {
                          audioSend: false,
                          videoSend: false
                        }, // We want recvonly audio/video
                        success: function (jsep) {
                          Janus.debug("Got SDP!");
                          Janus.debug(jsep);
                          var body = {
                            "request": "start"
                          };
                          config.recordPlayHandler.send({
                            "message": body,
                            "jsep": jsep
                          });
                        },
                        error: function (error) {
                          Janus.error("WebRTC error:", error);
                          alert(JSON.stringify(error));
                        }
                      });
                      if (result["warning"]) {
                        alert(result["warning"]);
                      }
                    } else if (event === 'recording') {
                      // Got an ANSWER to our recording OFFER
                      if (jsep !== null && jsep !== undefined) {
                        config.recordPlayHandler.handleRemoteJsep({
                          jsep: jsep
                        });
                      }
                      var id = result["id"];
                      if (id !== null && id !== undefined) {
                        Janus.log("The ID of the current recording is " + id);
                        config.recordingId = id;
                      }
                    } else if (event === 'slow_link') {
                      if (result) {
                        var uplink = result["uplink"];
                        if (uplink !== 0) {
                          if (config.onWarning) config.onWarning(msg);
                          // Janus detected issues when receiving our media, let's slow down
                          if (!config.isShareScreenActive) {
                            let bandwidth = parseInt(bandwidth / 1.5);
                            config.recordPlayHandler.send({
                              'message': {
                                'request': 'configure',
                                'video-bitrate-max': bandwidth, // Reduce the bitrate
                                'video-keyframe-interval': 15000 // Keep the 15 seconds key frame interval
                              }
                            });
                          }
                        }
                      }
                    } else if (event === 'stopped' && result) {
                      Janus.log("Session has stopped!");
                      var id = result["id"];
                      if (config.recordingId !== null && config.recordingId !== undefined) {
                        if (config.recordingId !== id) {
                          Janus.warn("Not a stop to our recording?");
                          return;
                        }
                        alert('Recording completed! Check the list of recordings to replay it.')
                      }
                      // TODO reset recording session
                    }
                  }
                } else {
                  // FIXME Error?
                  var error = msg["error"];
                  alert(error)
                  //updateRecsList();
                }
              },
              onlocalstream: function (stream) {
                Janus.debug(" ::: Got a local stream :::");
                Janus.debug(stream);
                config.onRecordedPlay()
              },
              onremotestream: function (stream) {
                config.recordedplaystream = stream;
                Janus.debug(" ::: Got a remote stream :::");
                Janus.debug(stream);
                config.onRecordedPlay()
              },
              oncleanup: function () {
                Janus.log(" ::: Got a cleanup notification :::");
                // TODO reset recording session
              }
            });

          }
        },
        error: function (error) {
          if (config.videoRoomHandler) config.videoRoomHandler.alive = false;
          Janus.error(error);
          config.onError(error);
          // reject(error);
        },
        destroyed: function () {
          console.log('Destroyed');
        },
        iceServers: config.iceServers,
      });
    } catch (err) {
      // reject(err);
    }
  });
}


function getVideoStream() {
  var config = {
    video: true,
    audio: true
  };
  navigator.mediaDevices.getUserMedia(config)
    .then(function (s) {
      stream = s;
      document.getElementById('videolocal').setAttribute('src', window.URL.createObjectURL(s));
      getRecorder();
      console.log('get video connection')
      // createPeerConnection();
    });
};

function getRecorder() {
  var options = {
    mimeType: 'video/webm'
  };
  recorder = new MediaRecorder(stream, options);
  recorder.ondataavailable = videoDataHandler;
};

function videoDataHandler(event) {
  // console.log(event.data)
  // var reader = new FileReader();
  // reader.readAsArrayBuffer(event.data);
  // videoCounter++;
  // reader.onloadend = function (event) {
  //     console.log(reader.result);
  //     connection.send(reader.result);
  // };
};

function newRemoteFeed(id, display, audio, video) {
  // A new feed has been published, create a new plugin handle and attach to it as a subscriber
  var remoteFeed = null;
  config.janus.attach({
    plugin: "janus.plugin.videoroom",
    opaqueId: config.opaqueId,
    success: function (pluginHandle) {
      remoteFeed = pluginHandle;
      remoteFeed.simulcastStarted = false;
      Janus.log("Plugin attached! (" + remoteFeed.getPlugin() + ", id=" + remoteFeed.getId() + ")");
      Janus.log("  -- This is a subscriber");
      // We wait for the plugin to send us an offer
      var listen = {
        "request": "join",
        "room": config.room,
        "ptype": "subscriber",
        "feed": id,
        "pin": config.pin,
        "private_id": config.mypvtid
      };
      if (config.token) listen.token = config.token;
      // In case you don't want to receive audio, video or data, even if the
      // publisher is sending them, set the 'offer_audio', 'offer_video' or
      // 'offer_data' properties to false (they're true by default), e.g.:
      // 		listen["offer_video"] = false;
      // For example, if the publisher is VP8 and this.is Safari, let's avoid video
      if (video !== "h264" && Janus.webRTCAdapter.browserDetails.browser === "safari") {
        if (video) {
          video = video.toUpperCase()
        }
        Janus.debug("Publisher is using " + video + ", but Safari doesn't support it: disabling video");
        listen["offer_video"] = false;
      }
      listen["offer_data"] = true;
      remoteFeed.videoCodec = video;
      remoteFeed.send({
        "message": listen
      });

      // Setup DataChannel
      var body = {
        "request": "setup",
      }
      if (config.token) body.token = config.token;
      pluginHandle.send({
        "message": body
      });

    },
    error: function (error) {
      Janus.error("  -- Error attaching plugin...", error);
      config.onError("Error attaching plugin... " + error);
    },
    onmessage: function (msg, jsep) {
      Janus.debug(" ::: Got a message (subscriber) :::");
      Janus.debug(msg);
      config.videoRoomHandler.alive = true;
      var event = msg["videoroom"];
      Janus.debug("Event: " + event);
      if (msg["error"] !== undefined && msg["error"] !== null) {
        config.onError(msg["error"]);
      } else if (event != undefined && event != null) {
        if (event === "attached") {
          // Subscriber created and attached
          for (var i = 1; i < 15; i++) {
            if (config.feeds[i] === undefined || config.feeds[i] === null) {
              config.feeds[i] = remoteFeed;
              remoteFeed.rfindex = i;
              break;
            }
          }
          remoteFeed.rfid = msg["id"];
          remoteFeed.rfdisplay = msg["display"];
          if (remoteFeed.spinner === undefined || remoteFeed.spinner === null) {
            var target = document.getElementById('videoremote' + remoteFeed.rfindex);
            // Spinner
          } else {
            remoteFeed.spinner.spin();
          }
          Janus.log("Successfully attached to feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") in room " + msg["room"]);
        } else if (event === "event") {
          // Check if we got an event on a simulcast-related event from publisher
          var substream = msg["substream"];
          var temporal = msg["temporal"];
          if ((substream !== null && substream !== undefined) || (temporal !== null && temporal !== undefined)) {
            if (!remoteFeed.simulcastStarted) {
              remoteFeed.simulcastStarted = true;
              // Add some new buttons
              addSimulcastButtons(remoteFeed.rfindex, remoteFeed.videoCodec === "vp8");
            }
            // We just received notice that there's been a switch, update the buttons
            updateSimulcastButtons(remoteFeed.rfindex, substream, temporal);
          }
        } else {
          // What has just happened?
        }
      }
      if (jsep !== undefined && jsep !== null) {
        Janus.debug("Handling SDP as well...");
        Janus.debug(jsep);
        // Answer and attach
        remoteFeed.createAnswer({
          jsep: jsep,
          // Add data:true here if you want to subscribe to datachannels as well
          // (obviously only works if the publisher offered them in the first place)
          media: {
            audioSend: false,
            videoSend: false,
            data: true,
          }, // We want recvonly audio/video
          success: function (jsep) {
            Janus.debug("Got SDP!");
            Janus.debug(jsep);
            var body = {
              "request": "start",
              "room": config.room
            };
            if (config.token) body.token = config.token;
            remoteFeed.send({
              "message": body,
              "jsep": jsep
            });
          },
          error: function (error) {
            Janus.error("WebRTC error:", error);
            config.onError("WebRTC error... " + JSON.stringify(error));
          }
        });
      }
    },
    webrtcState: function (on) {
      Janus.log("Janus says this.WebRTC PeerConnection (feed #" + remoteFeed.rfindex + ") is " + (on ? "up" : "down") + " now");
    },
    onlocalstream: function (stream) {
      // The subscriber stream is recvonly, we don't expect anything here
    },
    ondata: function (data) {
      try {
        data = JSON.parse(data);
        config.onMessage(data);
      } catch (err) {
        config.onMessage({
          error: `Failed to parse JSON : ${err}`
        });
      }
    },
    onremotestream: function (stream) {
      Janus.debug("Remote feed #" + remoteFeed.rfindex);

      config.remotestreams[remoteFeed.rfindex] = {}
      config.remotestreams[remoteFeed.rfindex].index = remoteFeed.rfindex;
      config.remotestreams[remoteFeed.rfindex].feedId = remoteFeed.getId();
      config.remotestreams[remoteFeed.rfindex].stream = stream;
      config.onRemoteJoin(remoteFeed.rfindex, remoteFeed.rfdisplay, remoteFeed.getId());
      if (config.onVolumeMeterUpdate) {
        let ctx = new AudioContext();
        let meter = volumeMeter(ctx, {
          tweenIn: 2,
          tweenOut: 6,
          skip: config.volumeMeterSkip
        }, (volume) => {
          config.onVolumeMeterUpdate(remoteFeed.rfindex, volume);
        });
        let src = ctx.createMediaStreamSource(config.remotestreams[remoteFeed.rfindex].stream);
        src.connect(meter);



        config.remotestreams[remoteFeed.rfindex].stream.onended = meter.stop.bind(meter);
        config.remotestreams[remoteFeed.rfindex].feed = remoteFeed;
      }
    },
    oncleanup: function () {
      Janus.log(" ::: Got a cleanup notification (remote feed " + id + ") :::");
      if (remoteFeed.spinner !== undefined && remoteFeed.spinner !== null) {
        remoteFeed.spinner.stop();
      }
      remoteFeed.spinner = null;
      delete(config.remotestreams[remoteFeed.rfindex]);
      config.onRemoteUnjoin(remoteFeed.rfindex, remoteFeed.rfdisplay);
    }
  });
}

var doSimulcast = (getQueryStringValue("simulcast") === "yes" || getQueryStringValue("simulcast") === "true");



class Room {

  constructor(options) {
    // Make sure the entire configuration get flushed first
    config = {
      remotestreams: {},
      feeds: [],
      bitrateTimer: []
    }
    window.remotestreams = config.remotestreams;
    // Assign the values
    config.pin = options.pin;
    config.server = options.server || null;
    config.opaqueId = "videoroomtest-" + this.randomString(12);
    config.room = options.room || null;
    config.publishOwnFeed = options.publishOwnFeed || false;
    config.extensionId = options.extensionId || null;
    config.token = options.token || null;
    config.useRecordPlugin = options.useRecordPlugin || false;
    config.volumeMeterSkip = options.volumeMeterSkip || 0;
    // Events
    config.onLocalJoin = options.onLocalJoin || null;
    config.onRemoteJoin = options.onRemoteJoin || null;
    config.onRemoteUnjoin = options.onRemoteUnjoin || null;
    config.onRecordedPlay = options.onRecordedPlay || null;
    config.onMessage = options.onMessage || null;
    config.onDestroyed = options.onDestroyed || null;
    config.onVolumeMeterUpdate = options.onVolumeMeterUpdate || null;
    config.onError = options.onError || null;
    config.onWarning = options.onWarning || null;
    config.iceServers = options.iceServers || [{
      urls: "stun:stun.l.google.com:19302"
    }];
  }


  init() {
    return new Promise((resolve, reject) => {
      try {
        if (!config.server) {
          throw 'server value is needed.';
        }
        Janus.init({
          debug: "all",
          extensionId: config.extensionId,
          callback: function () {
            start()
              .then(() => {
                resolve();
              })
              .catch((err) => {
                // reject(err);
              });
          }
        });
      } catch (err) {
        // reject(err);
      }
    });
  }

  randomString(len) {
    var charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var randomString = '';
    for (var i = 0; i < len; i++) {
      var randomPoz = Math.floor(Math.random() * charSet.length);
      randomString += charSet.substring(randomPoz, randomPoz + 1);
    }
    return randomString;
  };

  stop() {
    if (config.janus) {
      this.stopRecording();
      // Make sure the webcam and microphone got turned off first
      if (config.mystream) {
        let tracks = config.mystream.getTracks();
        for (let i in tracks) {
          if (tracks[i]) {
            tracks[i].stop();
          }
        }
      }
      // Destroy the session
      config.janus.destroy();
    }
  }

  register(options) {
    new Promise((resolve, reject) => {
      try {
        if (!options || (options && !options.username)) {
          throw 'username value is needed.';
        }
        if (!options || (options && !options.room)) {
          throw 'room value is needed.';
        }
        config.username = options.username || config.username;
        config.room = options.room || config.room;

        var register = {
          "request": "join",
          "pin": config.pin,
          "room": config.room,
          "ptype": "publisher",
          "display": config.username
        };
        if (config.token) register.token = config.token;
        config.videoRoomHandler.send({
          "message": register
        });
        resolve();
      } catch (err) {
        // reject(err);
      }
    });
  }

  toggleMuteAudio() {
    return new Promise((resolve, reject) => {
      try {
        let muted = config.videoRoomHandler.isAudioMuted();
        Janus.log((muted ? "Unmuting" : "Muting") + " local stream...");
        if (muted) {
          config.videoRoomHandler.unmuteAudio();
        } else {
          config.videoRoomHandler.muteAudio();
        }
        resolve(config.videoRoomHandler.isAudioMuted());
      } catch (err) {
        // reject(err);
      }
    });
  }

  toggleMuteVideo() {
    return new Promise((resolve, reject) => {
      try {
        let muted = config.videoRoomHandler.isVideoMuted();
        Janus.log((muted ? "Unmuting" : "Muting") + " local stream...");
        if (muted) {
          config.videoRoomHandler.unmuteVideo();
        } else {
          config.videoRoomHandler.muteVideo();
        }
        resolve(config.videoRoomHandler.isVideoMuted());
      } catch (err) {
        // reject(err);
      }
    });
  }

  toggleVideo() {
    return new Promise((resolve, reject) => {
      let videoStopped = false;
      let audioStopped = false;
      if (!config.mystream) {
        // reject('No local stream.');
        return;
      } else {
        if (config.mystream.getVideoTracks().length > 0) {
          videoStopped = config.mystream.getVideoTracks()[0].readyState === 'ended';
        }
        if (config.mystream.getAudioTracks().length > 0) {
          audioStopped = config.mystream.getAudioTracks()[0].readyState === 'ended';
        }
      }
      if (!videoStopped) {
        config.mystream.getVideoTracks()[0].stop();
      }
      if (config.publishOwnFeed) {
        publishOwnFeed({
          audioSend: !audioStopped,
          videoSend: videoStopped,
          replaceVideo: videoStopped,
          replaceAudio: audioStopped,
        }, () => {
          resolve(!videoStopped)
        });
      } else {
        resolve(!videoStopped)
      }
    });
  }

  sendMessage(data) {
    return new Promise((resolve, reject) => {
      try {
        config.videoRoomHandler.data({
          text: JSON.stringify(data),
          success: function () {
            resolve(data);
          },
          error: function (err) {
            // reject(err);
          },
        });
      } catch (err) {
        // reject(err)
      }
    });
  }

  attachStream(target, index) {
    return new Promise((resolve, reject) => {
      try {
        if (index === 0) {
          Janus.attachMediaStream(target, config.mystream);
          // multiStreamRecorder.stream = config.mystream
          // multiStreamRecorder.addStream(multiStreamRecorder.stream)
        } else {
          Janus.attachMediaStream(target, config.remotestreams[index].stream);
          // multiStreamRecorder.addStream(config.remotestreams[index].stream)

        }
        resolve();
      } catch (err) {
        // reject(err);
      }
    });
  }

  isShareScreenStream(index) {
    return new Promise((resolve, reject) => {
      var res = false;
      var tracks;
      try {
        if (index === 0) {
          tracks = config.mystream.getVideoTracks()
        } else if (config.remotestreams[index].stream) {
          tracks = config.remotestreams[index].stream.getVideoTracks()
        }
        if (tracks && tracks[0] && tracks[0].label &&
          // Video tracks from webcam got labeled as "Integrated Camera" or "iSight"
          // TODO collect this label value from various browsers/devices
          (tracks[0].label.toLowerCase().indexOf('monitor') > -1 || // Firefox, "Primary Monitor"
            tracks[0].label.toLowerCase().indexOf('screen') > -1 || // Chrome, "screen:0:0"
            tracks[0].label.toLowerCase().indexOf('window:') > -1 // Chrome, "window:37483", window capture
          )
        ) {
          res = true;
        }
        resolve(res)
      } catch (err) {
        // reject(err);
      }
    });
  }

  attachRecordedPlayStream(target) {
    return new Promise((resolve, reject) => {
      try {
        Janus.attachMediaStream(target, config.recordedplaystream);
        resolve();
      } catch (err) {
        // reject(err);
      }
    });
  }

  shareScreen() {
    return new Promise((resolve, reject) => {
      if (Janus.webRTCAdapter.browserDetails.browser === 'safari') {
        // reject(new Error('No video support for Safari browser.'));
      }
      if (!config.publishOwnFeed) {
        return // reject();
      }
      try {
        unpublishOwnFeed()
        setTimeout(() => {
          shareScreen((err) => {
            if (err) {
              // reject(err)
              return;
            }
            resolve();
          });
        }, 500);
      } catch (err) {
        // reject(err);
      }
    });
  }

  stopShareScreen() {
    return new Promise((resolve, reject) => {
      if (!config.publishOwnFeed) {
        return // reject();
      }
      try {
        unpublishOwnFeed()
        setTimeout(() => {
          publishOwnFeed({
            audioSend: true,
            replaceVideo: true,
            replaceAudio: true,
          }, () => {
            resolve()
          });
        }, 500);
      } catch (err) {
        // reject(err);
      }
    });
  }

  publishOwnFeed(opts, cb) {
    publishOwnFeed(opts, cb);
  }

  unpublishOwnFeed() {
    unpublishOwnFeed();
  }

  newRemoteFeed(id, display, audio, video) {
    newRemoteFeed(id, display, audio, video);
  }

  createRoom(options) {
    return new Promise((resolve, reject) => {
      try {
        options = options || {}
        config.room = options.room || null
        // TODO handle room's secret
        var body = {
          "request": "create",
          "room": config.room,
        };
        if (config.token) body.token = config.token;
        config.videoRoomHandler.send({
          "message": body,
        });
        // TODO catch the response
        resolve();
      } catch (err) {
        // reject(err);
      }
    });
  }

  removeRoom() {
    return new Promise((resolve, reject) => {
      try {
        // TODO handle room's secret
        var body = {
          "request": "destroy",
          "room": config.room,
        };
        if (config.token) body.token = config.token;
        config.videoRoomHandler.send({
          "message": body,
        });
        resolve();
      } catch (err) {
        // reject(err);
      }
    });
  }

  getRecordedList() {
    return new Promise((resolve, reject) => {
      var body = {
        "request": "list"
      };
      Janus.debug("Sending message (" + JSON.stringify(body) + ")");
      config.recordPlayHandler.send({
        "message": body,
        success: function (result) {
          resolve(result);
        },
        error: function (err) {
          // reject(err);
        }
      });
    });
  }

  stopPlayback() {
    return stopPlayback()
  }

  recordedPlayback(recordId) {
    return new Promise((resolve, reject) => {
      var play = {
        "request": "play",
        "id": parseInt(recordId, 10)
      };
      if (config.recordedplaystream) {
        let tracks = config.recordedplaystream.getTracks();
        for (let i in tracks) {
          if (tracks[i]) {
            tracks[i].stop();
          }
        }
        config.recordedplaystream = null;
        stopPlayback()
          .then(() => {
            config.recordPlayHandler.send({
              "message": play,
              success: function () {
                resolve();
              },
              error: function (err) {
                // reject(err);
              }
            });
          })
          .catch((err) => {
            // reject(err);
          });
      } else {
        config.recordPlayHandler.send({
          "message": play,
          success: function () {
            resolve();
          },
          error: function (err) {
            // reject(err);
          }
        });
      }
    });
  }

  // startRecording(options) {
  //   return startRecording(options)
  // }

  // stopRecording() {
  //   return new Promise((resolve, reject) => {
  //     if (config.recordPlayHandler) {
  //       var stop = {
  //         "request": "stop"
  //       };
  //       config.recordPlayHandler.send({
  //         "message": stop,
  //         success: function() {
  //           resolve();
  //         },
  //         error: function(err) {
  //           // reject(err);
  //         }
  //       });
  //     }
  //   });
  // }
  getStream(streamIndex) {
    return new Promise((resolve, reject) => {
      try {
        if ('' + streamIndex === '0') {
          resolve(config.mystream);
        } else {
          if (config.remotestreams[streamIndex]) {
            resolve(config.remotestreams[streamIndex].stream);
          } else {
            // reject(new Error('No such stream index: ' + streamIndex));
          }
        }
      } catch (e) {
        // reject(e);
      }
    });
  }
  getStreamBitrate(streamIndex) {
    return new Promise((resolve, reject) => {
      try {
        if (config.remotestreams[streamIndex] && config.remotestreams[streamIndex].feed && '' + streamIndex !== '0') {
          resolve(config.remotestreams[streamIndex].feed.getBitrate());
        } else if (config.videoRoomHandler && '' + streamIndex === '0') {
          resolve(config.videoRoomHandler.alive ? true : false);
        } else {
          // reject(new Error('No such stream index: ' + streamIndex));
        }
      } catch (e) {
        // reject(e);
      }
    });
  }

}



// TODO Fix me.
// Helpers to create Simulcast-related UI, if enabled
// Helpers to create Simulcast-related UI, if enabled
function addSimulcastButtons(feed, temporal) {
  var index = feed;
  $('#videoremote' + index).parent().append(
    '<div id="simulcast' + index + '" class="btn-group-vertical btn-group-vertical-xs pull-right">' +
    '	<div class"row">' +
    '		<div class="btn-group btn-group-xs" style="width: 100%">' +
    '			<button id="sl' + index + '-2" type="button" class="btn btn-primary" data-toggle="tooltip" title="Switch to higher quality" style="width: 33%">SL 2</button>' +
    '			<button id="sl' + index + '-1" type="button" class="btn btn-primary" data-toggle="tooltip" title="Switch to normal quality" style="width: 33%">SL 1</button>' +
    '			<button id="sl' + index + '-0" type="button" class="btn btn-primary" data-toggle="tooltip" title="Switch to lower quality" style="width: 34%">SL 0</button>' +
    '		</div>' +
    '	</div>' +
    '	<div class"row">' +
    '		<div class="btn-group btn-group-xs hide" style="width: 100%">' +
    '			<button id="tl' + index + '-2" type="button" class="btn btn-primary" data-toggle="tooltip" title="Cap to temporal layer 2" style="width: 34%">TL 2</button>' +
    '			<button id="tl' + index + '-1" type="button" class="btn btn-primary" data-toggle="tooltip" title="Cap to temporal layer 1" style="width: 33%">TL 1</button>' +
    '			<button id="tl' + index + '-0" type="button" class="btn btn-primary" data-toggle="tooltip" title="Cap to temporal layer 0" style="width: 33%">TL 0</button>' +
    '		</div>' +
    '	</div>' +
    '</div>'
  );
  // Enable the simulcast selection buttons
  $('#sl' + index + '-0').removeClass('btn-primary btn-success').addClass('btn-primary')
    .unbind('click').click(function () {
      toastr.info("Switching simulcast substream, wait for it... (lower quality)", null, {
        timeOut: 2000
      });
      if (!$('#sl' + index + '-2').hasClass('btn-success'))
        $('#sl' + index + '-2').removeClass('btn-primary btn-info').addClass('btn-primary');
      if (!$('#sl' + index + '-1').hasClass('btn-success'))
        $('#sl' + index + '-1').removeClass('btn-primary btn-info').addClass('btn-primary');
      $('#sl' + index + '-0').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
      feeds[index].send({
        message: {
          request: "configure",
          substream: 0
        }
      });
    });
  $('#sl' + index + '-1').removeClass('btn-primary btn-success').addClass('btn-primary')
    .unbind('click').click(function () {
      toastr.info("Switching simulcast substream, wait for it... (normal quality)", null, {
        timeOut: 2000
      });
      if (!$('#sl' + index + '-2').hasClass('btn-success'))
        $('#sl' + index + '-2').removeClass('btn-primary btn-info').addClass('btn-primary');
      $('#sl' + index + '-1').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
      if (!$('#sl' + index + '-0').hasClass('btn-success'))
        $('#sl' + index + '-0').removeClass('btn-primary btn-info').addClass('btn-primary');
      feeds[index].send({
        message: {
          request: "configure",
          substream: 1
        }
      });
    });
  $('#sl' + index + '-2').removeClass('btn-primary btn-success').addClass('btn-primary')
    .unbind('click').click(function () {
      toastr.info("Switching simulcast substream, wait for it... (higher quality)", null, {
        timeOut: 2000
      });
      $('#sl' + index + '-2').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
      if (!$('#sl' + index + '-1').hasClass('btn-success'))
        $('#sl' + index + '-1').removeClass('btn-primary btn-info').addClass('btn-primary');
      if (!$('#sl' + index + '-0').hasClass('btn-success'))
        $('#sl' + index + '-0').removeClass('btn-primary btn-info').addClass('btn-primary');
      feeds[index].send({
        message: {
          request: "configure",
          substream: 2
        }
      });
    });
  if (!temporal) // No temporal layer support
    return;
  $('#tl' + index + '-0').parent().removeClass('hide');
  $('#tl' + index + '-0').removeClass('btn-primary btn-success').addClass('btn-primary')
    .unbind('click').click(function () {
      toastr.info("Capping simulcast temporal layer, wait for it... (lowest FPS)", null, {
        timeOut: 2000
      });
      if (!$('#tl' + index + '-2').hasClass('btn-success'))
        $('#tl' + index + '-2').removeClass('btn-primary btn-info').addClass('btn-primary');
      if (!$('#tl' + index + '-1').hasClass('btn-success'))
        $('#tl' + index + '-1').removeClass('btn-primary btn-info').addClass('btn-primary');
      $('#tl' + index + '-0').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
      feeds[index].send({
        message: {
          request: "configure",
          temporal: 0
        }
      });
    });
  $('#tl' + index + '-1').removeClass('btn-primary btn-success').addClass('btn-primary')
    .unbind('click').click(function () {
      toastr.info("Capping simulcast temporal layer, wait for it... (medium FPS)", null, {
        timeOut: 2000
      });
      if (!$('#tl' + index + '-2').hasClass('btn-success'))
        $('#tl' + index + '-2').removeClass('btn-primary btn-info').addClass('btn-primary');
      $('#tl' + index + '-1').removeClass('btn-primary btn-info').addClass('btn-info');
      if (!$('#tl' + index + '-0').hasClass('btn-success'))
        $('#tl' + index + '-0').removeClass('btn-primary btn-info').addClass('btn-primary');
      feeds[index].send({
        message: {
          request: "configure",
          temporal: 1
        }
      });
    });
  $('#tl' + index + '-2').removeClass('btn-primary btn-success').addClass('btn-primary')
    .unbind('click').click(function () {
      toastr.info("Capping simulcast temporal layer, wait for it... (highest FPS)", null, {
        timeOut: 2000
      });
      $('#tl' + index + '-2').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
      if (!$('#tl' + index + '-1').hasClass('btn-success'))
        $('#tl' + index + '-1').removeClass('btn-primary btn-info').addClass('btn-primary');
      if (!$('#tl' + index + '-0').hasClass('btn-success'))
        $('#tl' + index + '-0').removeClass('btn-primary btn-info').addClass('btn-primary');
      feeds[index].send({
        message: {
          request: "configure",
          temporal: 2
        }
      });
    });
}

function updateSimulcastButtons(feed, substream, temporal) {
  // Check the substream
  var index = feed;
  if (substream === 0) {
    toastr.success("Switched simulcast substream! (lower quality)", null, {
      timeOut: 2000
    });
    $('#sl' + index + '-2').removeClass('btn-primary btn-success').addClass('btn-primary');
    $('#sl' + index + '-1').removeClass('btn-primary btn-success').addClass('btn-primary');
    $('#sl' + index + '-0').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
  } else if (substream === 1) {
    toastr.success("Switched simulcast substream! (normal quality)", null, {
      timeOut: 2000
    });
    $('#sl' + index + '-2').removeClass('btn-primary btn-success').addClass('btn-primary');
    $('#sl' + index + '-1').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
    $('#sl' + index + '-0').removeClass('btn-primary btn-success').addClass('btn-primary');
  } else if (substream === 2) {
    toastr.success("Switched simulcast substream! (higher quality)", null, {
      timeOut: 2000
    });
    $('#sl' + index + '-2').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
    $('#sl' + index + '-1').removeClass('btn-primary btn-success').addClass('btn-primary');
    $('#sl' + index + '-0').removeClass('btn-primary btn-success').addClass('btn-primary');
  }
  // Check the temporal layer
  if (temporal === 0) {
    toastr.success("Capped simulcast temporal layer! (lowest FPS)", null, {
      timeOut: 2000
    });
    $('#tl' + index + '-2').removeClass('btn-primary btn-success').addClass('btn-primary');
    $('#tl' + index + '-1').removeClass('btn-primary btn-success').addClass('btn-primary');
    $('#tl' + index + '-0').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
  } else if (temporal === 1) {
    toastr.success("Capped simulcast temporal layer! (medium FPS)", null, {
      timeOut: 2000
    });
    $('#tl' + index + '-2').removeClass('btn-primary btn-success').addClass('btn-primary');
    $('#tl' + index + '-1').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
    $('#tl' + index + '-0').removeClass('btn-primary btn-success').addClass('btn-primary');
  } else if (temporal === 2) {
    toastr.success("Capped simulcast temporal layer! (highest FPS)", null, {
      timeOut: 2000
    });
    $('#tl' + index + '-2').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
    $('#tl' + index + '-1').removeClass('btn-primary btn-success').addClass('btn-primary');
    $('#tl' + index + '-0').removeClass('btn-primary btn-success').addClass('btn-primary');
  }
}

// var startButton = document.getElementById('start-recording');
// startButton.addEventListener('click', function (e) {
//     // connection.send(JSON.stringify({ type: 'start-recording' }));
//     console.log('starting to record');
//     recorder.start(3000);

// });

// var stopButton = document.getElementById('stop-recording');
// stopButton.addEventListener('click', function (e) {
//   console.log('stop recording');
//   recorder.stop();
//     // connection.send(JSON.stringify({ type: 'stop-recording' }));
// });

// getVideoStream()

module.exports = Room;
