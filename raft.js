/*
 * Copyright (c) 2016 Diego Ongaro.
 * Licensed under the MIT license.
 * For full license text, see LICENSE.md file in the repo root or
 * https://opensource.org/licenses/MIT
 */

'use strict';

let colorbrewer = require('colorbrewer');
let d3 = require('d3');
let _ = require('lodash');

let Changesets = require('runway-compiler/lib/changesets.js');
let Graph = require('runway-browser/lib/stackedevents.js');
let Menu = require('runway-browser/lib/menu.js');

let radianToAngle = radian => radian / Math.PI * 180;
let angleToRadian = angle => angle / 180 * Math.PI;

// Calculates where points on the circumference of a circle lie.
// Angles are measured from the right horizon clockwise.
class Circle {
  constructor(cx, cy, r) {
    this.cx = cx;
    this.cy = cy;
    this.r = r;
  }
  radian(radian) {
    return {
      x: _.round(this.cx + this.r * Math.cos(radian), 2),
      y: _.round(this.cy + this.r * Math.sin(radian), 2),
    };
  }
  angle(angle) {
    return this.radian(angleToRadian(angle));
  }
}

class Markers {
  constructor(defs) {
    this.defs = defs;
    this.added = [];
  }
  has(id) {
    return _.includes(this.added, id);
  }
  append(id) {
    return this.defs.append('marker')
      .attr('id', id);
  }
  get(id) {
    return this.defs.select(`marker#${id}`);
  }
  ref(id) {
    return `url(#${id})`;
  }
}

class Transform {
  constructor() {
    this.operations = [];
  }
  toString() {
    return _.reverse(_.clone(this.operations)).join(' ');
  }
  translate(x, y) {
    this.operations.push(`translate(${x}, ${y})`);
    return this;
  }
  rotate(angle) {
    this.operations.push(`rotate(${angle})`);
    return this;
  }
}

let View = function(controller, svg, module) {

  let model = module.env;
  let menu = new Menu('raft', controller, model);

  svg = d3.select(svg)
    .classed('raft', true)
    .append('g');

  let rotate = (array, n) => array.slice(n).concat(array.slice(0, n));
  window.rotate = rotate;

  let messageTypes = ['RequestVote', 'AppendEntries'];
  let messageColor = d3.scale.category10().domain(messageTypes).range(colorbrewer.Set2[6]);
  let termColor = d3.scale.category10().range(rotate(colorbrewer.Set2[6], 1));

  let markers = new Markers(svg.append('defs'));

  let createArrow = selection =>
    selection
      .attr({
        viewBox: '0 -5 10 10',
        refX: 5,
        refY: 0,
        markerWidth: 4,
        markerHeight: 4,
        orient:'auto',
      })
      .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('class', 'arrowHead');

  markers.append('arrow')
    .call(createArrow);
  messageTypes.forEach(t => {
    markers.append(`arrow-${t}`)
      .call(createArrow)
      .style('stroke', messageColor(t))
      .style('fill', messageColor(t));
  });

  d3.select('head').append('style')
    .text(`
        .raft {
          font-size: 60;
        }
        .raft circle.ring {
          stroke: black;
          stroke-width: 5;
          fill: none;
        }
        .raft .leader.current text.serverId {
          fill: red;
        }
        .raft .legend {
          font-size: 40;
        }
        .raft .noleader .legend {
          visibility: hidden;
        }

        .raft .server g.votes {
          visibility: hidden;
        }
        .raft .server.candidate g.votes {
          visibility: visible;
          fill: white;
        }
        .raft .server.candidate g.votes .granted {
          fill: black;
        }

        .raft .message {
          stroke-width: 4;
          stroke: black;
          fill: black;
        }
        .raft .message.RequestVote {
          stroke: ${messageColor('RequestVote')};
          fill: ${messageColor('RequestVote')};
        }
        .raft .message.AppendEntries {
          stroke: ${messageColor('AppendEntries')};
          fill: ${messageColor('AppendEntries')};
        }
        .raft .message line.direction {
          stroke-width: 5;
        }
        .playback .raft .message line.direction {
          visibility: hidden;
        }
        .raft .message line.plus {
          visibility: hidden;
        }
        .raft .message.RequestVote.response circle,
        .raft .message.AppendEntries.request.empty circle,
        .raft .message.AppendEntries.response circle {
          fill-opacity: 0;
        }
        .raft .message.RequestVote.response line.plus.horizontal,
        .raft .message.AppendEntries.response line.plus.horizontal {
          visibility: visible;
        }
        .raft .message.RequestVote.response.granted line.plus.vertical,
        .raft .message.AppendEntries.response.success line.plus.vertical {
          visibility: visible;
        }

        .raft .logs .bg rect {
          fill: #dddddd;
          stroke: gray;
        }
        .raft .logs .entry rect {
          stroke: black;
          stroke-width: 8;
        }
        .raft .logs .entry.uncommitted rect {
          stroke-dasharray: 20, 15;
        }

        .raft line.nextIndex {
          stroke-width: 6;
          stroke: black;
        }

        .raft .noLeader .nextIndex,
        .raft .noLeader .matchIndex,
        .raft .leader.current .nextIndex,
        .raft .leader.current .matchIndex {
          visibility: hidden;
        }
    `);

  let numServers = model.vars.get('servers').size();
  let numIndexes = model.vars.get('servers').index(1).lookup('log').capacity();
  let electionTimeout = 100000;
  let serverRadius = 70;
  let outerServerRadius = serverRadius + 10;
  let ringLayout = new Circle(500, 500, 300);
  let serverLabelCircle = new Circle(500, 500, 420);
  let peersCircle = new Circle(0, 0, serverRadius * .7); // relative to server midpoint

  // The current leader is defined as the leader of the largest term, or
  // undefined if no leaders. This is its server ID.
  let currentLeaderId = undefined;

  let serverAngle = serverId => 270 + 360 / numServers * (serverId - 1);

  // Wraps the model's Server Record with additional information for drawing
  class Server {
    constructor(serverId, serverVar) {
      this.serverVar = serverVar;
      this.serverId = serverId;
      let angle = serverAngle(this.serverId);
      this.point = ringLayout.angle(angle);
      this.labelPoint = serverLabelCircle.angle(angle);

      this.timeoutArc = d3.svg.arc()
        .innerRadius(serverRadius)
        .outerRadius(outerServerRadius)
        .startAngle(0)
        .endAngle(0);
    }

    getVotes() {
      return this.serverVar.lookup('state').match({
        Candidate: cstate => cstate.peers.map(peer => {
          if (peer.lookup('voteGranted').toString() == 'True') {
            return 'granted';
          } else if (peer.lookup('voteResponded').toString() == 'True') {
            return 'denied';
          } else {
            return 'noreply';
          }
        }),
        Offline:  model.vars.get('servers').map(s => 'N/A'),
        Follower: model.vars.get('servers').map(s => 'N/A'),
        Leader:   model.vars.get('servers').map(s => 'N/A'),
      });
    }

    isOffline() {
      return this.serverVar.lookup('state').match({
        Offline: true,
        Follower: false,
        Candidate: false,
        Leader: false,
      });
    }

    stateClasses() {
      let classes = [];
      this.serverVar.lookup('state').match({
        Offline: () => {
          classes.push('offline');
        },
        Follower: () => {
          classes.push('follower');
        },
        Candidate: () => {
          classes.push('candidate');
        },
        Leader: () => {
          classes.push('leader');
          if (currentLeaderId === this.serverId) {
            classes.push('current');
          } else {
            classes.push('stale');
          }
        },
      });
      return classes.join(' ');
    }

    update(clock) {
      let timeoutFrac = _.clamp(
        (this.serverVar.lookup('timeoutAt').value - clock) /
        (electionTimeout * 2),
        0, 1);
      this.serverVar.lookup('state').match({
        Offline: () => { timeoutFrac = 0; },
        Leader:  () => { timeoutFrac = 1; },
      });
      this.timeoutArc.endAngle(2 * Math.PI * timeoutFrac);
      return this;
    }
  } // class Server

  let serverData = model.vars.get('servers').map((v, id) => new Server(id, v));

  class Servers {
    draw(selection, changes) {
      if (!Changesets.affected(changes, ['clock', 'servers'])) {
        return;
      }

      serverData.forEach(s => s.update(controller.workspace.clock));
      let updateG = serversG
        .selectAll('g.server')
        .data(serverData);

      // Server enter
      let enterG = updateG.enter()
        .append('g');
      enterG.append('text')
        .attr('class', 'serverId')
        .attr('x', s => s.labelPoint.x - s.point.x)
        .attr('y', s => s.labelPoint.y - s.point.y)
        .style('text-anchor', 'middle')
        .style('dominant-baseline', 'middle')
        .text(s => `S${s.serverId}`);
      enterG.append('circle')
        .attr('class', 'serverbg')
        .attr('r', serverRadius);
      enterG.append('path')
        .attr('class', 'timeout');
      enterG.append('text')
        .attr('class', 'term')
        .style({
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
        });
      enterG.append('g')
        .attr('class', 'votes');
      enterG.on('click', s => {
        menu.open([
          {
            rule: 'shutdown',
            args: s.serverId,
          },
          {
            rule: 'startup',
            args: s.serverId,
          },
          {
            rule: 'startNewElection',
            label: 'timeout',
            args: s.serverId,
          },
          {
            label: 'client request',
            rule: 'clientRequest',
            args: s.serverId,
          },
          {
            label: 'disconnect from network',
            rule: 'disconnect',
            args: s.serverId,
          },
          {
            label: 'connect to network',
            rule: 'connect',
            args: s.serverId,
          },
        ]);
      });

      // Server update
      updateG
        .attr('transform', s => new Transform()
          .translate(s.point.x, s.point.y)
          .toString())
        .attr('class', s => 'server clickable ' + s.stateClasses());
      updateG.select('.serverbg')
        .style('fill', s => s.isOffline()
          ? '#aaaaaa'
          : termColor(s.serverVar.lookup('currentTerm').value));
      updateG.select('text.term')
        .text(s => s.serverVar.lookup('currentTerm').toString());
      if (Changesets.affected(changes, 'clock')) {
        updateG.select('path.timeout')
          .attr('d', s => s.timeoutArc());
      }

      // Votes
      this.drawVotes(updateG.select('g.votes'));
    } // Servers.draw()

    drawVotes(votesSel) {
      let updateSel = votesSel.selectAll('circle')
        .data(s => s.getVotes().map((vote, i) => ({
          server: s,
          vote: vote,
          point: peersCircle.angle(serverAngle(i + 1)),
        })));
      let enterSel = updateSel.enter();
      enterSel
        .append('circle')
          .attr('cx', v => v.point.x)
          .attr('cy', v => v.point.y)
          .attr('r', serverRadius * .2);
      updateSel
        .attr('class', v => v.vote);
    } // Servers.drawVotes()

} // class Servers

  class Message {
    constructor(messageVar) {
      this.messageVar = messageVar;
      this.fromPoint = ringLayout.angle(serverAngle(messageVar.lookup('from').value));
      this.toPoint = ringLayout.angle(serverAngle(messageVar.lookup('to').value));
      let rise = this.toPoint.y - this.fromPoint.y;
      let run = this.toPoint.x - this.fromPoint.x;
      this.angle = radianToAngle(Math.atan2(rise, run));
      // Adjust fromPoint, toPoint to reach edge of server, not center
      this.fromPoint = new Circle(this.fromPoint.x, this.fromPoint.y, serverRadius)
        .angle(this.angle);
      this.toPoint = new Circle(this.toPoint.x, this.toPoint.y, serverRadius)
        .angle(this.angle + 180);

      this.point = {
        x: 0,
        y: 0,
      };

      this.classes = ['message', 'clickable'];
      this.messageVar.lookup('payload').match({
        RequestVoteRequest: r => {
          this.type = 'RequestVote';
          this.classes.push(
            'RequestVote',
            'request');
        },
        RequestVoteResponse: r => {
          this.type = 'RequestVote';
          this.classes.push(
            'RequestVote',
            'response',
            r.lookup('granted').toString() === 'True' ? 'granted' : 'denied');
        },
        AppendEntriesRequest: r => {
          this.type = 'AppendEntries';
          this.classes.push(
            'AppendEntries',
            'request',
            r.lookup('entries').empty() ? 'empty' : 'nonempty');
        },
        AppendEntriesResponse: r => {
          this.type = 'AppendEntries';
          this.classes.push(
            'AppendEntries',
            'response',
            r.lookup('success').toString() === 'True' ? 'success' : 'fail');
        },
      });
    }

    update(clock) {
      let sentAt = this.messageVar.lookup('sentAt').value;
      let deliverAt = this.messageVar.lookup('deliverAt').value;
      let frac = .7;
      if (sentAt > 0) {
        frac = _.clamp((clock - sentAt) / (deliverAt - sentAt),
                     0, 1);
      }
      this.point.x = _.round(this.fromPoint.x + (this.toPoint.x - this.fromPoint.x) * frac, 2);
      this.point.y = _.round(this.fromPoint.y + (this.toPoint.y - this.fromPoint.y) * frac, 2);
      return this;
    }
  } // class Message

  class Messages {
    constructor() {
      this.messageRadius = 15;
    }

    draw(selection, changes) {
      if (!Changesets.affected(changes, ['network', 'clock'])) {
        return;
      }

      let messageData = model.vars.get('network').map(v =>
      new Message(v).update(controller.workspace.clock));
      let updateSel = messagesG
        .selectAll('g.message')
        .data(messageData);

      // Message enter
      let enterSel = updateSel.enter()
        .append('g');
      enterSel
        .on('click', (m, i) => {
          menu.open([
            {
              label: 'drop',
              rule: 'dropMessage',
              args: i,
            },
            {
              label: 'duplicate',
              rule: 'duplicateMessage',
              args: i,
            },
          ]);
        });
      enterSel.append('circle')
        .attr('r', this.messageRadius);
      enterSel.append('line')
        .attr('class', 'direction')
        .attr({
          x1: 0,
          x2: this.messageRadius * 2,
          y1: 0,
          y2: 0,
        });
      enterSel.append('line')
        .attr('class', 'plus horizontal')
        .attr({
          x1: -this.messageRadius,
          x2: this.messageRadius,
          y1: 0,
          y2: 0,
        });
      enterSel.append('line')
        .attr('class', 'plus vertical')
        .attr({
          x1: 0,
          x2: 0,
          y1: -this.messageRadius,
          y2: this.messageRadius,
        });

      // Message update
      updateSel
        .attr('class', m => m.classes.join(' '))
        .attr('transform', m => new Transform()
          .translate(m.point.x, m.point.y)
          .toString());
      updateSel.select('line.direction')
        .attr('marker-end', m => markers.ref(`arrow-${m.type}`))
        .attr('transform', m => new Transform()
          .translate(this.messageRadius, 0)
          .rotate(m.angle)
          .toString());

      // Message exit
      updateSel.exit().remove();
    } // Messages.draw()
  } // class Messages

  class Logs {
    constructor() {
      this.x = 1000;
      this.y = 100;
      this.width = 500;
      this.height = 800;
      this.serverLabelWidth = 90;
      this.indexHeight = 60;
      this.rowHeight = this.height / 8;
      this.columnWidth = .9 * (this.width - this.serverLabelWidth) / numIndexes;
      this.indexes = _.range(numIndexes).map(i => i + 1);
    }

    entryBBox(serverId, index) {
      return {
        x: this.serverLabelWidth + (index - 1) * this.columnWidth,
        y: this.indexHeight + (serverId - 1 + .1) * this.rowHeight,
        width: this.columnWidth,
        height: .8 * this.rowHeight,
      };
    }

    drawFixed(selection) {
      selection.attr('transform', new Transform()
        .translate(this.x, this.y)
        .toString());
      let enterSel = selection
        .append('g')
          .attr('class', 'indexes')
          .selectAll('text')
          .data(this.indexes).enter();
      enterSel.append('text')
        .attr('class', 'index')
        .attr('x', (index, i) => this.serverLabelWidth + i * this.columnWidth)
        .attr('y', 0)
        .style('dominant-baseline', 'text-before-edge')
        .text(index => index);

      let legend = selection
        .append('g')
          .attr('class', 'legend');
      let legendX = _.round(this.width / 3, 2);
      let niY = _.round(this.indexHeight +
        (numServers + .5) * this.rowHeight, 2);
      let miY = _.round(niY + 2/3 * this.rowHeight, 2);
      legend.append('line')
        .attr('class', 'nextIndex')
        .attr('x1', legendX)
        .attr('x2', legendX)
        .attr('y1', niY + .2 * this.rowHeight)
        .attr('y2', niY)
        .attr('marker-end', markers.ref('arrow'));
      legend.append('text')
        .attr('x', legendX + 20)
        .attr('y', niY)
        .style('dominant-baseline', 'central')
        .text('= next index');
      legend.append('circle')
        .attr('class', 'matchIndex')
        .attr('cx', legendX)
        .attr('cy', miY)
        .attr('r', 10);
      legend.append('text')
        .attr('x', legendX + 20)
        .attr('y', miY)
        .style('dominant-baseline', 'central')
        .text('= match index');
    }

    draw(selection, changes) {
      if (!Changesets.affected(changes, 'servers')) {
        return;
      }

      let updateSel = logsG
        .selectAll('g.log')
        .data(serverData);

      // Log enter
      let enterSel = updateSel.enter()
        .append('g')
        .attr('class', 'log');
      enterSel.append('text')
        .attr('class', 'serverId')
        .attr('x', 0)
        .attr('y', (s, i) => this.indexHeight + (i + .5) * this.rowHeight)
        .style('dominant-baseline', 'central')
        .text(s => `S${s.serverId}`);

      let bg = enterSel.append('g')
        .attr('class', 'bg');
      bg.selectAll('rect')
        .data(server => this.indexes.map(index => ({
          server: server,
          index: index,
          bbox: this.entryBBox(server.serverId, index),
        })))
        .enter()
        .append('rect')
          .attr('x', si => si.bbox.x)
          .attr('y', si => si.bbox.y)
          .attr('width', si => si.bbox.width)
          .attr('height', si => si.bbox.height);
      enterSel.append('g')
        .attr('class', 'entries');
      enterSel.append('circle')
        .attr('class', 'matchIndex')
        .attr('cy', (s, i) => this.indexHeight + (i + .9) * this.rowHeight)
        .attr('r', 10);
      enterSel.append('line')
        .attr('class', 'nextIndex')
        .attr('y1', (s, i) => this.indexHeight + (i + 1.1) * this.rowHeight)
        .attr('y2', (s, i) => this.indexHeight + (i + .9) * this.rowHeight)
        .attr('marker-end', markers.ref('arrow'));

      // Log update
      updateSel
        .attr('class', s => 'log ' + s.stateClasses());
      let entriesUpdateSel = updateSel.select('g.entries').selectAll('g')
        .data(server => server.serverVar.lookup('log').map((entry, index) => ({
          server: server,
          entry: entry,
          index: index,
          bbox: this.entryBBox(server.serverId, index),
        })));
      let entriesEnterSel = entriesUpdateSel.enter()
        .append('g');
      entriesEnterSel.append('rect')
        .attr('x', entry => entry.bbox.x)
        .attr('y', entry => entry.bbox.y)
        .attr('width', entry => entry.bbox.width)
        .attr('height', entry => entry.bbox.height);
      entriesEnterSel.append('text')
        .attr('x', entry => entry.bbox.x + .5 * entry.bbox.width)
        .attr('y', entry => entry.bbox.y + .5 * entry.bbox.height)
        .style('text-anchor', 'middle')
        .style('dominant-baseline', 'central');
      entriesUpdateSel
        .attr('class', entry => ('entry ' +
          (entry.server.serverVar.lookup('commitIndex').value >= entry.index
            ? 'committed'
            : 'uncommitted')));
      entriesUpdateSel.select('rect')
        .style('fill', entry => termColor(entry.entry.lookup('term').value));
      entriesUpdateSel.select('text')
        .text(entry => entry.entry.lookup('term').toString());
      entriesUpdateSel.exit().remove();

      if (currentLeaderId !== undefined) {
        let currentLeader = model.vars.get('servers').index(currentLeaderId);
        currentLeader.lookup('state').match({
          Leader: lstate => {
            let peers = lstate.lookup('peers');
            let nextIndex = peerId => peers.index(peerId).lookup('nextIndex').value;
            let matchIndex = peerId => peers.index(peerId).lookup('matchIndex').value;
            let nextX = peer => this.serverLabelWidth + (nextIndex(peer.serverId) - 0.5) * this.columnWidth;
            let matchX = peer => this.serverLabelWidth + matchIndex(peer.serverId) * this.columnWidth;
            updateSel.selectAll('.nextIndex')
              .attr('x1', peer => nextX(peer))
              .attr('x2', peer => nextX(peer));
            updateSel.selectAll('.matchIndex')
              .attr('cx', peer => matchX(peer));
          },
        });
      }

      // Log exit
      updateSel.exit().remove();
    } // Logs.draw()
  } // class Logs

  svg.append('circle')
    .attr('class', 'ring')
    .attr({
      cx: ringLayout.cx,
      cy: ringLayout.cy,
      r: ringLayout.r,
    });

  let serversG = svg
    .append('g')
      .attr('class', 'servers');
  let messagesG = svg
    .append('g')
      .attr('class', 'messages');
  let logsG = svg
    .append('g')
      .attr('class', 'logs');

  let allChanged = [''];
  let servers = new Servers();
  servers.draw(serversG, allChanged);
  let messages = new Messages();
  messages.draw(messagesG, allChanged);
  let logs = new Logs();
  logs.drawFixed(logsG, allChanged);
  logs.draw(logsG, allChanged);

  let graph = controller.mountTab(elem => new Graph(controller, elem, ['stable']), 'graph', 'Graph');
  window.graph = graph;

  return {
    bigView: true,
    wideView: true,
    name: 'RaftView',
    update: function(changes) {
      currentLeaderId = _.last(
      _.sortBy(model.vars.get('servers')
        .map((s, id) => ({server: s, id: id}))
        .filter(si => si.server.lookup('state').match({
          Leader: true,
        })),
        si => si.server.lookup('currentTerm').value)
      .map(si => si.id));

      svg.classed({
        hasLeader: currentLeaderId !== undefined,
        noLeader: currentLeaderId === undefined,
      });

      servers.draw(serversG, changes);
      messages.draw(messagesG, changes);
      logs.draw(logsG, changes);

      graph.push(controller.workspace.takeOutput().elections);
    }
  };

}; // View

module.exports = View;
