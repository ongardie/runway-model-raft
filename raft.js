"use strict";

let d3 = require('d3');
let _ = require('lodash');

// Calculates where points on the circumference of a circle lie.
class Circle {
  constructor(cx, cy, r) {
    this.cx = cx;
    this.cy = cy;
    this.r = r;
  }
  at(frac) {
    let radian = frac * 2 * Math.PI;
    return {
      x: _.round(this.cx + this.r * Math.sin(radian), 2),
      y: _.round(this.cy - this.r * Math.cos(radian), 2),
    };
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
  };
  rotate(angle) {
    this.operations.push(`rotate(${angle})`);
    return this;
  }
}

let View = function(controller, svg, module) {

svg = d3.select(svg)
  .classed('raft', true)
  .append('g');


let markers = new Markers(svg.append('defs'));

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

      .raft .server .serverbg {
        stroke: black;
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

      .raft .message line {
        stroke-width: 4;
        stroke: black;
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

let model = module.env;

let numServers = model.vars.get('servers').size();
let numIndexes = model.vars.get('servers').index(1).lookup('log').capacity();
let electionTimeout = 100000;
let ringLayout = new Circle(250, 500, 200);
let serverLabelCircle = new Circle(250, 500, 300);

// The current leader is defined as the leader of the largest term, or
// undefined if no leaders. This is its server ID.
let currentLeaderId = undefined;

let termColor = d3.scale.category10();

// Wraps the model's Server Record with additional information for drawing
class Server {
  constructor(serverId, serverVar) {
    this.serverVar = serverVar;
    this.serverId = serverId;
    this.frac = (this.serverId - 1) / numServers;
    this.point = ringLayout.at(this.frac);
    this.labelPoint = serverLabelCircle.at(this.frac);
    this.peersCircle = new Circle(this.point.x, this.point.y, 40);

    this.timeoutArc = d3.svg.arc()
      .innerRadius(50)
      .outerRadius(60)
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
      Follower: model.vars.get('servers').map(s => 'N/A'),
      Leader: model.vars.get('servers').map(s => 'N/A'),
    });
  }

  stateClasses() {
    let classes = [];
    this.serverVar.lookup('state').match({
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
    let timeoutFrac = ((this.serverVar.lookup('timeoutAt').value - clock) /
       (electionTimeout * 2));
    this.serverVar.lookup('state').match({
      Leader: () => { timeoutFrac = 1; },
    });
    this.timeoutArc.endAngle(2 * Math.PI * timeoutFrac);
    return this;
  }
}

let serverData = model.vars.get('servers').map((v, id) => new Server(id, v));

class Servers {
  constructor() {
  }

  draw(selection, changes) {
    if (changes === undefined) {
      changes = [''];
    }
    //Changesets.affected(changes, `servers[${serverId}]`);

    serverData.forEach(s => s.update(controller.workspace.clock));
    let updateG = serversG
      .selectAll('g.server')
      .data(serverData);

    // Server enter
    let enterG = updateG.enter()
      .append('g');
    enterG.append('text')
      .attr('class', 'serverId')
      .attr('x', s => s.labelPoint.x)
      .attr('y', s => s.labelPoint.y + 30)
      .style('text-anchor', 'middle')
      .text(s => `S${s.serverId}`);
    enterG.append('circle')
      .attr('class', 'serverbg')
      .attr('cx', s => s.point.x)
      .attr('cy', s => s.point.y)
      .attr('r', 50);
    enterG.append('path')
      .attr('class', 'timeout')
      .attr('transform', s => new Transform()
        .translate(s.point.x, s.point.y)
        .toString());
    enterG.append('text')
      .attr('class', 'term')
      .attr('x', s => s.point.x)
      .attr('y', s => s.point.y + 30)
      .style({
        'text-anchor': 'middle',
      });
    enterG.append('g')
      .attr('class', 'votes');

    // Server update
    updateG.attr('class', s => 'server ' + s.stateClasses());
    updateG.select('.serverbg')
      .style('fill', s => termColor(s.serverVar.lookup('currentTerm').value));
    updateG.select('path.timeout')
      .attr('d', s => s.timeoutArc());
    updateG.select('text.term')
      .text(s => s.serverVar.lookup('currentTerm').toString());

    // Votes
    this.drawVotes(updateG.select('g.votes'));
  } // Servers.draw()

  drawVotes(votesSel) {
    let updateSel = votesSel.selectAll('circle')
      .data(s => s.getVotes().map((vote, i) => ({
        server: s,
        vote: vote,
        point: s.peersCircle.at(i / numServers),
      })));
    let enterSel = updateSel.enter();
    enterSel
      .append('circle')
        .attr('cx', v => v.point.x)
        .attr('cy', v => v.point.y)
        .attr('r', 5);
    updateSel
      .attr('class', v => v.vote);
  } // Servers.drawVotes()

} // class Servers

let radianToAngle = radian => radian / (2 * Math.PI) * 360;

class Message {
  constructor(messageVar) {
    this.messageVar = messageVar;
    this.fromPoint = ringLayout.at((messageVar.lookup('from').value - 1) / numServers);
    this.toPoint = ringLayout.at((messageVar.lookup('to').value - 1) / numServers);
    let rise = this.toPoint.y - this.fromPoint.y;
    let run = this.toPoint.x - this.fromPoint.x;
    this.angle = radianToAngle(Math.atan(rise / run));
    if (run < 0) {
      this.angle += 180;
    }
    this.point = {
      x: 0,
      y: 0,
    };
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
}

class Messages {
  constructor() {
    markers.append('arrow')
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
  }

  draw(selection, changes) {
    /*
    Changesets.affected(changes, [
      'clock',
      `network[${index}]`,
    ]);
    */


    let messageData = model.vars.get('network').map(v =>
      new Message(v).update(controller.workspace.clock));
    let updateSel = messagesG
      .selectAll('g.message')
      .data(messageData);

    // Message enter
    let enterSel = updateSel.enter()
      .append('g');
    enterSel.append('circle')
      .attr('r', 15);
    enterSel.append('line')
      .attr({
        x1: 0,
        y1: 0,
        x2: 30,
        y2: 0,
        'marker-end': markers.ref('arrow'),
      });

    // Message update
    updateSel.attr('class', m => ('message ' + m.messageVar.lookup('payload').match({
          RequestVoteRequest: 'RequestVote request',
          RequestVoteResponse: 'RequestVote response',
          AppendEntriesRequest: 'AppendEntries request',
          AppendEntriesResponse: 'AppendEntries response',
        })));
    updateSel.select('circle')
      .attr('cx', m => m.point.x)
      .attr('cy', m => m.point.y);
    updateSel.select('line')
      .attr('transform', m => new Transform()
        .rotate(m.angle)
        .translate(m.point.x, m.point.y)
        .toString());

    // Message exit
    updateSel.exit().remove();

  } // Messages.draw()
}

class Logs {
  constructor() {
    this.x = 500;
    this.y = 100;
    this.width = 500;
    this.height = 800;
    this.serverLabelWidth = 90;
    this.indexHeight = 50;
    this.rowHeight = this.height / 8;
    this.columnWidth = .9 * (this.width - this.serverLabelWidth) / numIndexes;
    this.indexes = _.range(numIndexes).map(i => i + 1);
  }

  entryBBox(serverId, index) {
    return {
      x: this.x + this.serverLabelWidth + (index - 1) * this.columnWidth,
      y: this.y + this.indexHeight + (serverId - 1 + .1) * this.rowHeight,
      width: this.columnWidth,
      height: .8 * this.rowHeight,
    };
  }

  drawFixed(selection) {
    let enterSel = selection
      .append('g')
        .attr('class', 'indexes')
        .selectAll('text')
        .data(this.indexes).enter();
    enterSel.append('text')
      .attr('class', 'index')
      .attr('x', (index, i) => this.x + this.serverLabelWidth + i * this.columnWidth)
      .attr('y', this.y + .8 * this.indexHeight)
      .text(index => index);
  }

  draw(selection, changes) {
    /*
    Changesets.affected(changes, [
      'servers',
    ]);
    */
    let updateSel = logsG
      .selectAll('g.log')
      .data(serverData);

    // Log enter
    let enterSel = updateSel.enter()
      .append('g')
      .attr('class', 'log');
    enterSel.append('text')
      .attr('class', 'serverId')
      .attr('x', (s, i) => this.x)
      .attr('y', (s, i) => this.y + this.indexHeight + (i + .8) * this.rowHeight)
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
      .attr('cy', (s, i) => this.y + this.indexHeight + (i + .9) * this.rowHeight)
      .attr('r', 10);
    enterSel.append('line')
      .attr('class', 'nextIndex')
      .attr('y1', (s, i) => this.y + this.indexHeight + (i + 1.1) * this.rowHeight)
      .attr('y2', (s, i) => this.y + this.indexHeight + (i + .9) * this.rowHeight)
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
        .attr('x', entry => entry.bbox.x)
        .attr('y', entry => entry.bbox.y + .8 * entry.bbox.height)
        .attr('width', entry => entry.bbox.width)
        .attr('height', entry => entry.bbox.height)
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
          let nextX = peer => this.x + this.serverLabelWidth + (nextIndex(peer.serverId) - 0.5) * this.columnWidth;
          let matchX = peer => this.x + this.serverLabelWidth + matchIndex(peer.serverId) * this.columnWidth;
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
}

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

let servers = new Servers();
servers.draw(serversG);
let messages = new Messages();
messages.draw(messagesG);
let logs = new Logs();
logs.drawFixed(logsG);
logs.draw(logsG);

return {
  bigView: true,
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
  }
};

}; // View

module.exports = View;
