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

let markers = new Markers(d3.select(svg).append('defs'));

d3.select('head').append('style')
  .text(`
      .server .serverbg {
        stroke: black;
      }
      .server.follower .serverbg {
        fill: gray;
      }
      .server.candidate .serverbg {
        fill: #aa6666;
      }
      .server.leader .serverbg {
        fill: #00aa00;
      }
      .server g.votes {
        visibility: hidden;
      }
      .server.candidate g.votes {
        visibility: visible;
        fill: white;
      }
      .server.candidate g.votes .granted {
        fill: black;
      }
  `);

let model = module.env;

let numServers = model.vars.get('servers').size();
let numIndexes = model.vars.get('servers').index(1).lookup('log').capacity();
let electionTimeout = 100000;
let ringLayout = new Circle(250, 500, 200);

// Wraps the model's Server Record with additional information for drawing
class Server {
  constructor(serverId, serverVar) {
    this.serverVar = serverVar;
    this.serverId = serverId;
    this.frac = (this.serverId - 1) / numServers;
    this.point = ringLayout.at(this.frac);
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

let serverData = model.getVar('servers').map((v, id) => new Server(id, v));

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
        'font-size': 80,
      });
    enterG.append('g')
      .attr('class', 'votes');

    // Server update
    updateG.attr('class', s => ('server ' + s.serverVar.lookup('state').match({
          Follower: 'follower',
          Candidate: 'candidate',
          Leader: 'leader',
        })));
    updateG.select('path.timeout')
      .attr('d', s => s.timeoutArc());
    updateG.select('text')
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


    let messageData = model.getVar('network').map(v =>
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
        'stroke-width': 4,
        'stroke': 'black',
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

d3.select(svg).append('circle')
  .attr({
    cx: ringLayout.cx,
    cy: ringLayout.cy,
    r: ringLayout.r,
  })
  .style({
    stroke: 'black',
    'stroke-width': 5,
    fill: 'none',
  });

let serversG = d3.select(svg)
  .append('g')
    .attr('class', 'servers');
let messagesG = d3.select(svg)
  .append('g')
    .attr('class', 'messages');

let servers = new Servers();
servers.draw(serversG);
let messages = new Messages();
messages.draw(messagesG);

return {
  bigView: true,
  name: 'RaftView',
  update: function(changes) {
    servers.draw(serversG, changes);
    messages.draw(messagesG, changes);
  }
};

}; // View

module.exports = View;
