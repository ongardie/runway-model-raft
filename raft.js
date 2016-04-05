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
      x: this.cx + this.r * Math.sin(radian),
      y: this.cy - this.r * Math.cos(radian),
    };
  }
}


let View = function(controller, svg, module) {

let model = module.env;

let numServers = model.vars.get('servers').size();
let numIndexes = model.vars.get('servers').index(1).lookup('log').capacity();
let ringLayout = new Circle(250, 500, 200);

// Wraps the model's Server Record with additional information for drawing
class Server {
  constructor(serverId, serverVar) {
    this.serverVar = serverVar;
    this.serverId = serverId;
    this.frac = (this.serverId - 1) / numServers;
    this.point = ringLayout.at(this.frac);
    this.peersCircle = new Circle(this.point.x, this.point.y, 40);
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

    let updateG = serversG
      .selectAll('g.server')
      .data(serverData);

    // Server enter
    let enterG = updateG.enter()
      .append('g')
        .attr('class', 'server');
    enterG.append('circle')
      .attr('cx', s => s.point.x)
      .attr('cy', s => s.point.y)
      .attr('r', 50);
    enterG.append('text')
      .attr('x', s => s.point.x)
      .attr('y', s => s.point.y + 30)
      .style({
        'text-anchor': 'middle',
        'font-size': 80,
      });
    enterG.append('g')
      .attr('class', 'votes');

    // Server update
    updateG.select('circle')
      .style('fill', s => s.serverVar.lookup('state').match({
          Follower: 'gray',
          Candidate: '#aa6666',
          Leader: '#00aa00',
      }))
      .style('stroke', 'black');

    updateG.select('text')
      .text(s => s.serverVar.lookup('currentTerm').toString());

    // Votes
    this.drawVotes(updateG.select('g.votes'));
  } // Servers.draw()

  drawVotes(votesSel) {
    votesSel.style('visibility', s => s.serverVar.lookup('state').match({
        Follower: 'hidden',
        Candidate: 'visible',
        Leader: 'hidden',
    }));

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
      .style('fill', v => v.vote == 'granted' ? 'black' : 'white');
  } // Servers.drawVotes()

} // class Servers


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

let servers = new Servers();
let serversG = d3.select(svg).append('g');
servers.draw(serversG);

return {
  bigView: true,
  name: 'RaftView',
  update: function(changes) {
    servers.draw(serversG, changes);
  }
};

}; // View

module.exports = View;
