"use strict";

let React = require('React');
let ReactDOM = require('ReactDOM');
let jQuery = require('jquery');
let Tooltip = require('Tooltip');
let Util = require('Util');

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
let tooltip = new Tooltip(jQuery('#tooltip'));

let numServers = 5;
let ring = new Circle(50, 50, 40);

let Server = React.createClass({
  render: function() {
    let serverId = this.props.serverId;
    let frac = (serverId - 1) / numServers;
    let point = ring.at(frac);
    let serverVar = model.getVar('servers').index(serverId);
    let fill = serverVar.lookup('state').match({
      Follower: 'gray',
      Candidate: '#aa6666',
      Leader: '#00aa00',
    });
    let votes = [];
    serverVar.lookup('state').match({
      Candidate: cstate => {
        let peersCircle = new Circle(point.x, point.y, 8);
        cstate.peers.forEach((peer, peerId) => {
          let peerPoint = peersCircle.at((peerId - 1) / numServers);
          let granted = (peer.lookup('voteGranted').toString() == 'True');
          votes.push(<circle
            key={peerId}
            cx={peerPoint.x} cy={peerPoint.y} r={1}
            style={{fill: granted ? 'black' : 'white'}} />);
        });
      },
    });
    return <g>
        <circle cx={point.x} cy={point.y} r={10}
          style={{fill: fill, stroke: 'black'}} />
        <text x={point.x} y={point.y + 4}
          style={{textAnchor: 'middle'}}>
          {serverVar.lookup('currentTerm').toString()}
        </text>
        {votes}
      </g>;
  },
});

let Message = React.createClass({
  render: function() {
    let mvar = this.props.mvar;
    let fromPoint = ring.at((mvar.lookup('from').value - 1) / numServers);
    let toPoint = ring.at((mvar.lookup('to').value - 1) / numServers);
    let point = {
      x: fromPoint.x + (toPoint.x - fromPoint.x) * .7,
      y: fromPoint.y + (toPoint.y - fromPoint.y) * .7,
    };
    return <circle cx={point.x} cy={point.y} r={3} />;
  },
});

let RaftView = React.createClass({
  render: function() {
    let servers = Util.range(numServers).map(i =>
      <Server key={i + 1} serverId={i + 1} />
    );
    let messages = [];
    model.getVar('network').forEach((messageVar, i) => {
      messages.push(<Message key={i} mvar={messageVar} />);
    });
    return <g>
        <circle id="ring" style={{fill: 'none', stroke: 'black'}}
          cx={50} cy={50} r={40} />
        {servers}
        {messages}
      </g>;
  },

});

let reactComponent = ReactDOM.render(<RaftView />, svg);

return {
  update: function() {
    // trigger a render
    reactComponent.setState({}, () => {
      tooltip.update();
      console.log('rendered');
    });
  }
};

}; // View

module.exports = View;
