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

  enter(selection) {
    selection.append('circle')
      .attr({
        cx: this.point.x,
        cy: this.point.y,
        r: 50,
      });
    selection.append('text')
      .attr({
        x: this.point.x,
        y: this.point.y + 30,
      })
      .style({
        'text-anchor': 'middle',
        'font-size': 80,
      });
    let votesG = selection.append('g')
      .attr('class', 'votes');
  } // enter

  update(selection, changes) {
    selection.select('circle')
      .style({
        fill: this.serverVar.lookup('state').match({
          Follower: 'gray',
          Candidate: '#aa6666',
          Leader: '#00aa00',
        }),
        stroke: 'black'
      });

    selection.select('text')
      .text(this.serverVar.lookup('currentTerm').toString());

    let votesG = selection.select('g.votes').selectAll('circle');
    let votesUpdate = votesG.data(this.getVotes());
    let self = this;
    votesUpdate.enter()
      .append('circle')
        .each(function(vote, i) {
          let peerPoint = self.peersCircle.at(i / numServers);
          d3.select(this).attr({
            cx: peerPoint.x,
            cy: peerPoint.y,
            r: 5,
          });
        });
    votesUpdate
      .style('visibility', this.serverVar.lookup('state').match({
        Follower: 'hidden',
        Candidate: 'visible',
        Leader: 'hidden',
      }))
      .style('fill', vote => vote == 'granted' ? 'black' : 'white');

  } // update()

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
    let enterG = updateG.enter();
    enterG.append('g')
        .attr('class', 'server')
        .each(function(server) { server.enter(d3.select(this)); });
    updateG.each(function(server) { server.update(d3.select(this)); });
  } // Servers.draw()
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
