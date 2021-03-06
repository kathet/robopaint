/**
 * @file Holds all Robopaint watercolorbot specific configuration and utility
 * functions.
 */

cncserver.wcb = {
  // Set the current status message
  status: function(msg, st) {

    var $status = $('#statusmessage');
    var classname = 'wait';

    // String messages, just set em
    if (typeof msg == "string") {
      $status.html(msg);
    } else if (Object.prototype.toString.call(msg) == "[object Array]") {
      // If it's an array, flop the message based on the status var

      // If there's not a second error message, default it.
      if (msg.length == 1) msg.push('Connection Problem &#x2639;');

      $status.html((st == false) ? msg[1] : msg[0]);
    }

    // If stat var is actually set
    if (typeof st != 'undefined') {
      if (typeof st == 'string') {
        classname = st;
      } else {
        classname = (st == false) ? 'error' : 'success'
      }

    }

    $status.attr('class', classname); // Reset class to only the set class
  },

  // Grouping function to do a full wash of the brush
  fullWash: function(callback, useDip) {
    var toolExt = useDip ? 'dip' : '';

    switch(parseInt(robopaint.settings.penmode)) {
      case 3:
      case 2: // Dissallow water
        cncserver.wcb.status('Full wash command ignored for draw mode ' + robopaint.settings.penmode);
        if (callback) callback(true);
        break;
      default:
        cncserver.wcb.status('Doing a full brush wash...');
        cncserver.api.tools.change('water0' + toolExt, function(){
          cncserver.api.tools.change('water1' + toolExt, function(){
            cncserver.api.tools.change('water2' + toolExt, function(d){
              cncserver.api.pen.resetCounter();
              cncserver.state.media = 'water0';
              cncserver.wcb.status(['Brush should be clean'], d);
              if (callback) callback(d);
            });
          });
        });
    }
  },

  // Get the name of paint/water/media on the brush
  getMediaName: function(toolName) {
    if (typeof toolName != 'string') toolName = cncserver.state.media;

    if (toolName.indexOf('water') !== -1) {
      return "Water";
    } else {
      return cncserver.config.colors[toolName.substr(5, 1)].name;
    }
  },

  // Wrapper for toolchange to manage pen mode logic
  setMedia: function(toolName, callback){
    var name = cncserver.wcb.getMediaName(toolName).toLowerCase();
    var mode = parseInt(robopaint.settings.penmode);

    // Water change
    if (name == "water") {
      switch(mode) {
        case 3: // Dissallow all
        case 2: // Dissallow water
          cncserver.wcb.status('Water ignored for draw mode ' + mode);
          if (callback) callback(true);
          return;
      }
    } else { // Color Change
      switch(mode) {
        case 3: // Dissallow all
        case 1: // Dissallow paint
          cncserver.wcb.status('Paint ignored for draw mode ' + mode);
          if (callback) callback(true);
          return;
      }
    }

    // If we've gotten this far, we can make the change!

    // Save the targeted media (separate from media state)
    cncserver.state.mediaTarget = toolName;

    // Visually show the selection
    var idName = toolName.indexOf('dip') !== -1 ? toolName.slice(0, -3) : toolName;
    $('nav#tools a.selected').removeClass('selected');
    $('nav#tools #' + idName).addClass('selected');

    cncserver.wcb.status('Putting some ' + name + ' on the brush...');
    cncserver.api.tools.change(toolName, function(d){
      cncserver.wcb.status(['There is now ' + name + ' on the brush'], d);
      cncserver.api.pen.resetCounter();
      if (callback) callback(d);
    });

  },

  // Wet the brush and get more of targeted media, then return to
  // point given and trigger callback
  getMorePaint: function(point, callback) {
    var name = cncserver.wcb.getMediaName(cncserver.state.mediaTarget).toLowerCase();

    // Reset the counter for every mode on getMorePaint
    cncserver.api.pen.resetCounter();

    // Change what happens here depending on penmode
    switch(parseInt(robopaint.settings.penmode)) {
      case 1: // Dissallow paint
        cncserver.wcb.status('Going to get some more water...')
        cncserver.api.tools.change("water0", function(d){
          cncserver.api.pen.up(function(d){
            cncserver.api.pen.move(point, function(d) {
              cncserver.wcb.status(['Continuing to paint with water']);
                cncserver.api.pen.down(function(d){
                  if (callback) callback(d);
                })
            });
          });
        });
        break;
      case 2: // Dissallow water
        cncserver.wcb.status('Going to get some more ' + name + ', no water...')
        cncserver.api.tools.change(cncserver.state.mediaTarget, function(d){
          cncserver.api.pen.up(function(d){
            cncserver.api.pen.move(point, function(d) {
              cncserver.wcb.status(['Continuing to paint with ' + name]);
                cncserver.api.pen.down(function(d){
                  if (callback) callback(d);
                })
            });
          });
        });
        break;
      case 3: // Dissallow All
        // Get paint ignored for draw mode 3
        if (callback) callback(true);
        break;
      default:
        cncserver.wcb.status('Going to get some more ' + name + '...')
        cncserver.api.tools.change('water0dip', function(d){
          cncserver.api.tools.change(cncserver.state.mediaTarget, function(d){
            cncserver.api.pen.up(function(d){
              cncserver.api.pen.move(point, function(d) {
                cncserver.wcb.status(['Continuing to paint with ' + name]);
                  cncserver.api.pen.down(function(d){
                    if (callback) callback(d);
                  })
              });
            });
          });
        });
    }
  },

  // Returns a list of the current colorset, sorted by luminosty, or Y value
  sortedColors: function() {
    var colorsort = [];

    // Use JS internal sort by slapping a zero padded value into an array
    $.each(cncserver.config.colors, function(index, color){
      if (index != 8) { // Ignore white
        colorsort.push(robopaint.utils.pad(color.color.YUV[0], 3) + '|' + 'color' + index);
      }
    });
    colorsort.sort().reverse();

    // Now extract the luminostiy from the array, and leave a clean list of colors
    for(var i in colorsort){
      colorsort[i] = colorsort[i].split('|')[1];
    }

    return colorsort;
  },

  // Move through all paths in a given context, pull out all jobs and begin to
  // Push them into the buffer
  autoPaint: function(context, callback, completeCallback) {
     // Clear all selections
    $('path.selected', context).removeClass('selected');

    // Make sure the colors are ready
    robopaint.utils.autoColor(context, false, cncserver.config.colors);

    // Holds all jobs keyed by color
    var jobs = {};
    var c = cncserver.config.colors;
    var colorMatch = robopaint.utils.closestColor;
    var convert = robopaint.utils.colorStringToArray;

    $('path', context).each(function(){
      var $p = $(this);
      var stroke = convert($p.css('stroke'));
      var fill = convert($p.css('fill'));

      // Occasionally, these come back undefined
      stroke = (stroke == null) ? false : 'color' + colorMatch(stroke, c);
      fill = (fill == null) ? false : 'color' + colorMatch(fill, c);

      // Account for fill/stroke opacity
      var op = $p.css('fill-opacity');
      if (typeof op != 'undefined') fill = (op < 0.5) ? false : fill;

      op = $p.css('stroke-opacity');
      if (typeof op != 'undefined') stroke = (op < 0.5) ? false : stroke;

      // Don't actually fill or stroke for white... (color8)
      if (fill == 'color8') fill = false;
      if (stroke == 'color8') stroke = false;

      // Add fill (and fill specific stroke) for path
      if (fill) {
        // Initialize the color job object as an array
        if (typeof jobs[fill] == 'undefined') jobs[fill] = [];

        // Give all non-stroked filled paths a stroke of the same color first
        if (!stroke) {
          jobs[fill].push({t: 'stroke', p: $p});
        }

        // Add fill job
        jobs[fill].push({t: 'fill', p: $p});
      }

      // Add stroke for path
      if (stroke) {
        // Initialize the color job object as an array
        if (typeof jobs[stroke] == 'undefined') jobs[stroke] = [];

        jobs[stroke].push({t: 'stroke', p: $p});
      }
    });

    var sortedColors = cncserver.wcb.sortedColors();

    var finalJobs = [];

    $.each(sortedColors, function(i, c){
      if (typeof jobs[c] != 'undefined'){
        var topPos = finalJobs.length;
        for(j in jobs[c]){
          var out = {
            c: c,
            t: jobs[c][j].t,
            p: jobs[c][j].p
          };

          // Place strokes ahead of fills, but retain color order
          if (out.t == 'stroke') {
            finalJobs.splice(topPos, 0, out);
          } else {
            finalJobs.push(out);
          }

        }
      }
    });


    cncserver.wcb.status('Auto Paint: ' +
      $('path', context).length + ' paths, ' +
      finalJobs.length + ' jobs');

    // Nothing manages color during automated runs, so you have to hang on to it.
    // Though we don't actually give it a default value, this ensures we get a
    // full wash before every auto-paint initialization
    var runColor;

    var jobIndex = 0;
    doNextJob();

    function doNextJob() {
      var job = finalJobs[jobIndex];
      var run = cncserver.cmd.run;

      if (job) {
        // Make sure the color matches, full wash and switch colors!
        if (runColor != job.c) {
          run(['wash', ['tool', job.c]]);
          runColor = job.c;
        }

        robopaint.utils.addShortcuts(job.p);

        // Clear all selections at start
        $('path.selected', context).removeClass('selected');

        if (job.t == 'stroke'){
          job.p.addClass('selected');
          run([['status', 'Drawing path ' + job.p[0].id + ' stroke...']]);
          cncserver.paths.runOutline(job.p, function(){
            jobIndex++;
            job.p.removeClass('selected'); // Deselect now that we're done
            doNextJob();
          })
        } else if (job.t == 'fill') {
          run([['status', 'Drawing path ' + job.p[0].id + ' fill...']]);

          function fillCallback(){
            jobIndex++;
            doNextJob();
          }

          cncserver.paths.runFill(job.p, fillCallback);
        }
      } else {
        if (callback) callback();
        run(['wash','park', ['status', 'AutoPaint Complete!'], ['custom', completeCallback]]);
        // Done!
      }
    }
  },

  // Simulation draw of current buffer
  simulateBuffer: function() {
    var c = $('#sim')[0];
    var ctx = c.getContext("2d");
    // Clear sim canvas
    c.width = c.width;

    // Set stroke color
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.lineWidth = 4;

    var doDraw = false;
    console.log('Start draw, buffer:', cncserver.state.buffer.length);

    // Move through every item in the command buffer
    for (var i in cncserver.state.buffer) {
      var next = cncserver.state.buffer[i];

      // Ensure it's an array
      if (typeof next == "string"){
        next = [next];
      }

      // What's the command?
      switch (next[0]) {
        case 'down':
          doDraw = false;
          //ctx.beginPath();
          break;
        case 'up':
          //ctx.closePath();
          doDraw = true;
          break;
        case 'move':
          // Add 48 to each side for 1/2in offset
          var x = next[1].x + 48; //(next[1].x / cncserver.canvas.width) * c.width;
          var y = next[1].y + 48; //(next[1].y / cncserver.canvas.height) * c.height;

          if (doDraw) {
            ctx.lineTo(x, y);
          } else {
            ctx.moveTo(x, y);
          }

          //ctx.lineTo(x, y);
          break;
      }
    }
    ctx.stroke();
    $('#sim').show();
    console.log('Simulation draw done!');

  },

  // Retrieve a fill path depending on config
  getFillPath: function(options){
    var ft = options.filltype;
    if (ft == 'tsp') {
      return $('#fill-spiral');
    } else {
      return $('#fill-' + ft);
    }
  }
};
