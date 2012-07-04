// Publish usernames to all the sockets
exports.publishUsernames = function(meetingID, sessionID) {
  var usernames = [];
  redisAction.getUsers(meetingID, function (users) {
      for (var i = users.length - 1; i >= 0; i--){
        usernames.push(users[i].username);
      };
      var receivers = sessionID != undefined ? sessionID : meetingID;
      pub.publish(receivers, JSON.stringify(['user list change', usernames]));
  });
  
  //check if no users left in meeting
  store.scard(redisAction.getUsersString(meetingID), function(err, cardinality) {
    if(cardinality == '0') {
      redisAction.processMeeting(meetingID);
    }
  });
};

//Get all messages from Redis and publish to a specific sessionID (user)
exports.publishMessages = function(meetingID, sessionID) {
  var messages = [];
  redisAction.getCurrentPresentationID(meetingID, function(presentationID) {
    redisAction.getCurrentPageID(meetingID, presentationID, function(pageID) {
      redisAction.getItems(meetingID, presentationID, pageID, "messages", function (messages) {
        var receivers = sessionID != undefined ? sessionID : meetingID;
        pub.publish(receivers, JSON.stringify(['all_messages', messages]));
      });
    });
  });
};

//Get all paths from Redis and publish to a specific sessionID (user)
exports.publishPaths = function(meetingID, sessionID) {
  var paths = [];
  redisAction.getCurrentPresentationID(meetingID, function(presentationID) {
    redisAction.getCurrentPageID(meetingID, presentationID, function(pageID) {
      redisAction.getItems(meetingID, presentationID, pageID, "currentpaths", function (paths) {
        var receivers = sessionID != undefined ? sessionID : meetingID;
        pub.publish(receivers, JSON.stringify(['all_paths', paths]));
      });
    });
  });
};

//Get all rectangles from Redis and publish to a specific sessionID (user)
exports.publishRects = function(meetingID, sessionID) {
  var rects = [];
  redisAction.getCurrentPresentationID(meetingID, function(presentationID) {
    redisAction.getCurrentPageID(meetingID, presentationID, function(pageID) {
      redisAction.getItems(meetingID, presentationID, pageID, "currentrects", function (rects) {
        var receivers = sessionID != undefined ? sessionID : meetingID;
        pub.publish(receivers, JSON.stringify(['all_rects', rects]));
      });
    });
  });
};

// All socket IO events that can be emitted by the client
exports.SocketOnConnection = function(socket) {
	
	//When a user sends a message...
	socket.on('msg', function (msg) {
	  msg = sanitizer.escape(msg);
	  var handshake = socket.handshake;
	  var sessionID = handshake.sessionID;
	  var meetingID = handshake.meetingID;
	  redisAction.isValidSession(meetingID, sessionID, function (reply) {
	    if(reply) {
	      if(msg.length > max_chat_length) {
    	    pub.publish(sessionID, JSON.stringify(['msg', "System", "Message too long."]));
    	  }
    	  else {
          var username = handshake.username;
          pub.publish(meetingID, JSON.stringify(['msg', username, msg]));
          var messageID = hat(); //get a randomly generated id for the message
          store.rpush(redisAction.getMessagesString(meetingID, null, null), messageID); //store the messageID in the list of messages
          store.hmset(redisAction.getMessageString(meetingID, null, null, messageID), "message", msg, "username", username);
        }
	    }
	  });
  });

	// When a user connects to the socket...
	socket.on('user connect', function () {
	  var handshake = socket.handshake;
	  var sessionID = handshake.sessionID;
	  var meetingID = handshake.meetingID;
	  redisAction.isValidSession(meetingID, sessionID, function (reply) {
		  if(reply) {
      	var username = handshake.username;
      	var socketID = socket.id;
    	
        socket.join(meetingID); //join the socket Room with value of the meetingID
        socket.join(sessionID); //join the socket Room with value of the sessionID
        
        //add socket to list of sockets.
        redisAction.getUserProperties(meetingID, sessionID, function(properties) {
          var numOfSockets = parseInt(properties.sockets, 10);
          numOfSockets+=1;
          store.hset(redisAction.getUserString(meetingID, sessionID), 'sockets', numOfSockets);
          if ((properties.refreshing == 'false') && (properties.dupSess == 'false')) {
            //all of the next sessions created with this sessionID are duplicates
            store.hset(redisAction.getUserString(meetingID, sessionID), "dupSess", true);
            socketAction.publishUsernames(meetingID);
    			}
    			else {
    			  store.hset(redisAction.getUserString(meetingID, sessionID), "refreshing", false);
    			  socketAction.publishUsernames(meetingID, sessionID);
  			  }
  			  socketAction.publishMessages(meetingID, sessionID);
  			  socketAction.publishPaths(meetingID, sessionID);
  			  socketAction.publishRects(meetingID, sessionID);
    		});
  		}
  	});
	});

	// When a user disconnects from the socket...
	socket.on('disconnect', function () {
	  var handshake = socket.handshake;
		var sessionID = handshake.sessionID;
		var meetingID = handshake.meetingID;
		//check if user is still in database
		redisAction.isValidSession(meetingID, sessionID, function (isValid) {
		  if(isValid) {
  		  var username = handshake.username;
    		var socketID = socket.id;

  			store.hset(redisAction.getUserString(meetingID, sessionID), "refreshing", true, function(reply) {
  			  setTimeout(function () {
  			    //in one second, check again...
    			  redisAction.isValidSession(meetingID, sessionID, function (isValid) {
    				  if(isValid) {
    				    redisAction.getUserProperties(meetingID, sessionID, function(properties) {
                  var numOfSockets = parseInt(properties.sockets, 10);
                  numOfSockets-=1;
      					  if(numOfSockets == 0) {
      					    store.srem(redisAction.getUsersString(meetingID), sessionID, function(err, num_deleted) {
      					      store.del(redisAction.getUserString(meetingID, sessionID), function(err, reply) {
          						  socketAction.publishUsernames(meetingID);
      					      });
      					    });
        					}
        					else store.hset(redisAction.getUserString(meetingID, sessionID), "sockets", numOfSockets);
      				  });
    				  }
      				else {
      					socketAction.publishUsernames(meetingID);
      				}
    				});
    			}, 1000);
  			}); 
  		}
		});
	});
  
  // When the user logs out
	socket.on('logout', function() {
	  var handshake = socket.handshake;
		var sessionID = handshake.sessionID;
		var meetingID = handshake.meetingID;
	  redisAction.isValidSession(meetingID, sessionID, function (isValid) {
	    if(isValid) {
  		  //initialize local variables
  		  var username = handshake.username;
  		  //remove the user from the list of users
  		  store.srem(redisAction.getUsersString(meetingID), sessionID, function(numDeleted) {
  		    //delete key from database
		      store.del(redisAction.getUserString(meetingID, sessionID), function(reply) {
            pub.publish(sessionID, JSON.stringify(['logout'])); //send to all users on same session (all tabs)
          	socket.disconnect(); //disconnect own socket      
  		    });
  		  });
  		}
  		socketAction.publishUsernames(meetingID);
	  });
	});
	
	// A user clicks to change to previous slide
	socket.on('prevslide', function (slide_num){
	  var handshake = socket.handshake;
		var sessionID = handshake.sessionID;
		var meetingID = handshake.meetingID;
	  redisAction.isValidSession(meetingID, sessionID, function (isValid) {
	    if(isValid) {
  	    var num;
  	    if(slide_num > 0 && slide_num <= maxImage) {
  	      if(slide_num == 1) num = maxImage;
  	      else num = slide_num - 1;
  	      pub.publish(meetingID, JSON.stringify(['changeslide', num, "images/presentation/test" + num + ".png"]));
        }
      }
    });
	});
	
	// A user clicks to change to next slide
	socket.on('nextslide', function (slide_num){
	  var handshake = socket.handshake;
		var sessionID = handshake.sessionID;
		var meetingID = handshake.meetingID;
	  redisAction.isValidSession(meetingID, sessionID, function (isValid) {
	    if(isValid) {
  	    var num;
  	    if(slide_num > 0 && slide_num <= maxImage) {
  	      if(slide_num == maxImage) num = 1;
  	      else num = slide_num + 1;
  	      pub.publish(meetingID, JSON.stringify(['changeslide', num, "images/presentation/test" + num + ".png"]));
        }
      }
    });
	});
	
	// When a line creation event is received
	socket.on('li', function (x1, y1, x2, y2) {
    pub.publish(socket.handshake.meetingID, JSON.stringify(['li', x1, y1, x2, y2]));
	});
	
	// When a rectangle creation event is received
	socket.on('makeRect', function (x, y) {
    pub.publish(socket.handshake.meetingID, JSON.stringify(['makeRect', x, y]));
	});
	
	// When a rectangle update event is received
	socket.on('updRect', function (x, y, w, h) {
    pub.publish(socket.handshake.meetingID, JSON.stringify(['updRect', x, y, w, h]));
	});
	
	// When a cursor move event is received
	socket.on('mvCur', function (x, y) {
	  pub.publish(socket.handshake.meetingID, JSON.stringify(['mvCur', x, y]));
	});
	
	// When a clear Paper event is received
	socket.on('clrPaper', function () {
	  var meetingID = socket.handshake.meetingID;
	  redisAction.getCurrentPresentationID(meetingID, function(presentationID) {
	    redisAction.getCurrentPageID(meetingID, presentationID, function(pageID) {
	      //delete all current paths
    	  redisAction.getItemIDs(meetingID, presentationID, pageID, 'currentpaths', function(meetingID, presentationID, pageID, itemIDs, itemName) {
          redisAction.deleteItemList(meetingID, presentationID, pageID, itemName, itemIDs);
        });
        //delete all current rects
    	  redisAction.getItemIDs(meetingID, presentationID, pageID, 'currentrects', function(meetingID, presentationID, pageID, itemIDs, itemName) {
          redisAction.deleteItemList(meetingID, presentationID, pageID, itemName, itemIDs);
        });
    	  pub.publish(meetingID, JSON.stringify(['clrPaper']));
	    });
	  });
	});
	
	// When a user is updating the viewBox of the paper
	socket.on('viewBox', function (xperc, yperc, wperc, hperc) {
	  pub.publish(socket.handshake.meetingID, JSON.stringify(['viewBox', xperc, yperc, wperc, hperc]));
	});
	
	// When a user is zooming
	socket.on('zoom', function(delta) {
	  pub.publish(socket.handshake.meetingID, JSON.stringify(['zoom', delta]));
	});
	
	// When a user finishes panning
	socket.on('panStop', function() {
	  pub.publish(socket.handshake.meetingID, JSON.stringify(['panStop']));
	});
	
	socket.on('savePath', function(path) {
	  var handshake = socket.handshake;
		var meetingID = handshake.meetingID;
	  var pathID = hat(); //get a randomly generated id for the message
	  redisAction.getCurrentPresentationID(meetingID, function(presentationID) {
	    redisAction.getCurrentPageID(meetingID, presentationID, function(pageID) {
	      store.rpush(redisAction.getPathsString(meetingID, presentationID, pageID), pathID); //store the pathID in the list of paths
        store.rpush(redisAction.getCurrentPathsString(meetingID, presentationID, pageID), pathID); //store the pathID in the list of currentpaths
        store.hmset(redisAction.getPathString(meetingID, presentationID, pageID, pathID), "path", path);
	    });
	  });
	});
	
	socket.on('saveRect', function(x, y, w, h) {
	  var handshake = socket.handshake;
		var meetingID = handshake.meetingID;
	  var rectID = hat(); //get a randomly generated id for the message
	  redisAction.getCurrentPresentationID(meetingID, function(presentationID) {
	    redisAction.getCurrentPageID(meetingID, presentationID, function(pageID) {
	      store.rpush(redisAction.getRectsString(meetingID, presentationID, pageID), rectID); //store the pathID in the list of paths
        store.rpush(redisAction.getCurrentRectsString(meetingID, presentationID, pageID), rectID); //store the pathID in the list of currentpaths
        store.hmset(redisAction.getRectString(meetingID, presentationID, pageID, rectID), "rect", [x, y, w, h].join(','));
	    });
	  });
	});
};