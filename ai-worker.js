console.log('WORKER_LOADED_V3');

// ========== AI Worker for Chinese Chess ==========

// 统一超时判断，所有循环/递归第一行调用
function isTimeOver() {
	if (_timedOut) return true;
	const cost = Date.now() - aiStartTime;
	if (cost > aiMaxTime) {
		_timedOut = true;
		return true;
	}
	return false;
}



// 1. Constants
var PN={king:{red:'帅',black:'将'},advisor:{red:'仕',black:'士'},elephant:{red:'相',black:'象'},horse:{red:'馬',black:'馬'},rook:{red:'車',black:'車'},cannon:{red:'炮',black:'砲'},pawn:{red:'兵',black:'卒'}};
var PV={king:10000,rook:1150,cannon:530,horse:430,elephant:140,advisor:140,pawn:48};
var aiWeights={
	attackKing:111.45,limitKingMob:34.44,approach:37.18,mobility:4.92,
	rookNotMoved:11.17,rookCrossed:85.47,rookDeveloped:60.06,
	horseDeveloped:32.78,cannonDeveloped:15.72,
	pieceSafety:79.19,hangingPenalty:81.89,tradeAccuracy:119.66,
	pawnPromotion:69.88,checkBonus:161.97,centerControl:20.63,
	rookCoordination:63.17,kingSafety:36.66
};
var aiDefaultWeights={attackKing:60,limitKingMob:35,approach:25,mobility:5,rookNotMoved:5,rookCrossed:80,rookDeveloped:60,horseDeveloped:25,cannonDeveloped:15};

var MA_PST_TABLE=[
[-10,-5,0,-8,-12,-8,0,-5,-10],[-5,10,15,10,-10,10,15,10,-5],
[15,20,35,30,25,30,35,20,15],[20,25,30,35,40,35,30,25,20],
[15,20,25,30,35,30,25,20,15],[10,15,20,25,30,25,20,15,10],
[-5,5,10,15,20,15,10,5,-5],[-10,-5,0,-5,-8,-5,0,-5,-10],
[-15,-10,-8,-10,-15,-10,-8,-10,-15],[-20,-15,-12,-15,-20,-15,-12,-15,-20]
];
var CHE_PST_TABLE=[
[20,18,16,14,12,14,16,18,20],[22,20,18,16,14,16,18,20,22],
[25,23,21,19,17,19,21,23,25],[30,28,26,24,22,24,26,28,30],
[35,33,31,29,27,29,31,33,35],[35,33,31,29,27,29,31,33,35],
[30,28,26,24,22,24,26,28,30],[20,18,16,14,12,14,16,18,20],
[15,13,11,9,7,9,11,13,15],[10,8,6,4,2,4,6,8,10]
];
var PAO_PST_TABLE=[
[15,14,13,11,9,11,13,14,15],[18,17,16,14,12,14,16,17,18],
[22,21,20,18,16,18,20,21,22],[26,25,24,22,20,22,24,25,26],
[30,29,28,26,24,26,28,29,30],[30,29,28,26,24,26,28,29,30],
[24,23,22,20,18,20,22,23,24],[16,15,14,12,10,12,14,15,16],
[12,11,10,8,6,8,10,11,12],[8,7,6,4,3,4,6,7,8]
];
var BIN_PST_TABLE=[
[-40,-35,-30,-25,-35,-25,-30,-35,-40],[-30,-25,-20,-15,-20,-15,-20,-25,-30],
[-20,-15,-10,-5,-10,-5,-10,-15,-20],[5,10,15,20,25,20,15,10,5],
[12,18,22,28,32,28,22,18,12],[18,24,30,36,40,36,30,24,18],
[10,15,20,25,30,25,20,15,10],[-5,0,5,8,10,8,5,0,-5],
[-10,-8,-5,-3,-5,-3,-5,-8,-10],[-15,-12,-10,-8,-10,-8,-10,-12,-15]
];
var STAGE_RATE={opening:{material:1.0,mobility:1.3,punish:1.4},mid:{material:1.0,mobility:1.0,punish:1.0},end:{material:1.25,mobility:0.6,punish:0.7}};
var FORM_SCORE={double_che:70,che_pao_line:65,double_knight:50,knight_cannon_mate:120,double_cannon:90,three_bin_push:65};
var TACTIC_SCORE={weak_unprotected:-35,che_unprotected:-85,pin_minor:-45,pin_che:-90,capture_double:40,check_normal:-200,double_check:-450,heart_horse_penalty:-75};

// 2. Board helper functions (standalone)
function iwb(r,c){ return r>=0&&r<=9&&c>=0&&c<=8; }
function iip(r,c,cl){
	if(c<3||c>5) return false;
	if(cl==='red') return r>=7&&r<=9;
	return r>=0&&r<=2;
}
function hcr(r,cl){
	if(cl==='red') return r<=4;
	return r>=5;
}
function cpb(board,r1,c1,r2,c2){
	var n=0;
	if(r1===r2){var mn=Math.min(c1,c2),mx=Math.max(c1,c2);for(var c=mn+1;c<mx;c++)if(board[r1][c])n++;}
	else if(c1===c2){var mn=Math.min(r1,r2),mx=Math.max(r1,r2);for(var r=mn+1;r<mx;r++)if(board[r][c1])n++;}
	return n;
}
function grmStandalone(board,r,c){
	var p=board[r][c];if(!p)return[];
	var m=[],tp=p.type,cl=p.color;
	if(tp==='king'){var ds=[[-1,0],[1,0],[0,-1],[0,1]];for(var i=0;i<ds.length;i++){var nr=r+ds[i][0],nc=c+ds[i][1];if(iip(nr,nc,cl)){var t=board[nr][nc];if(!t||t.color!==cl)m.push({row:nr,col:nc});}}}
	if(tp==='advisor'){var ds=[[-1,-1],[-1,1],[1,-1],[1,1]];for(var i=0;i<ds.length;i++){var nr=r+ds[i][0],nc=c+ds[i][1];if(iip(nr,nc,cl)){var t=board[nr][nc];if(!t||t.color!==cl)m.push({row:nr,col:nc});}}}
	if(tp==='elephant'){var em=[{dr:-2,dc:-2,er:-1,ec:-1},{dr:-2,dc:2,er:-1,ec:1},{dr:2,dc:-2,er:1,ec:-1},{dr:2,dc:2,er:1,ec:1}];for(var i=0;i<em.length;i++){var e=em[i],nr=r+e.dr,nc=c+e.dc;if(!iwb(nr,nc))continue;if(board[r+e.er][c+e.ec])continue;if(cl==='red'&&nr<5)continue;if(cl==='black'&&nr>4)continue;var t=board[nr][nc];if(!t||t.color!==cl)m.push({row:nr,col:nc});}}
	if(tp==='horse'){var hm=[{dr:-2,dc:-1,lr:-1,lc:0},{dr:-2,dc:1,lr:-1,lc:0},{dr:2,dc:-1,lr:1,lc:0},{dr:2,dc:1,lr:1,lc:0},{dr:-1,dc:-2,lr:0,lc:-1},{dr:-1,dc:2,lr:0,lc:1},{dr:1,dc:-2,lr:0,lc:-1},{dr:1,dc:2,lr:0,lc:1}];for(var i=0;i<hm.length;i++){var h=hm[i],nr=r+h.dr,nc=c+h.dc;if(!iwb(nr,nc))continue;if(board[r+h.lr][c+h.lc])continue;var t=board[nr][nc];if(!t||t.color!==cl)m.push({row:nr,col:nc});}}
	if(tp==='rook'){var ds=[[-1,0],[1,0],[0,-1],[0,1]];for(var i=0;i<ds.length;i++){var dr=ds[i][0],dc=ds[i][1],nr=r+dr,nc=c+dc;while(iwb(nr,nc)){var t=board[nr][nc];if(t){if(t.color!==cl)m.push({row:nr,col:nc});break;}m.push({row:nr,col:nc});nr+=dr;nc+=dc;}}}
	if(tp==='cannon'){var ds=[[-1,0],[1,0],[0,-1],[0,1]];for(var i=0;i<ds.length;i++){var dr=ds[i][0],dc=ds[i][1],nr=r+dr,nc=c+dc;while(iwb(nr,nc)){var t=board[nr][nc];if(t){nr+=dr;nc+=dc;while(iwb(nr,nc)){var t2=board[nr][nc];if(t2){if(t2.color!==cl)m.push({row:nr,col:nc});break;}nr+=dr;nc+=dc;}break;}m.push({row:nr,col:nc});nr+=dr;nc+=dc;}}}
	if(tp==='pawn'){if(cl==='red'){var fw=r-1;if(fw>=0){var t=board[fw][c];if(!t||t.color!==cl)m.push({row:fw,col:c});}if(hcr(r,cl)){if(c-1>=0){var t=board[r][c-1];if(!t||t.color!==cl)m.push({row:r,col:c-1});}if(c+1<=8){var t=board[r][c+1];if(!t||t.color!==cl)m.push({row:r,col:c+1});}}}else{var fw=r+1;if(fw<=9){var t=board[fw][c];if(!t||t.color!==cl)m.push({row:fw,col:c});}if(hcr(r,cl)){if(c-1>=0){var t=board[r][c-1];if(!t||t.color!==cl)m.push({row:r,col:c-1});}if(c+1<=8){var t=board[r][c+1];if(!t||t.color!==cl)m.push({row:r,col:c+1});}}}}
	return m;
}

function isMoveLegal(board, fr, fc, tr, tc, color) {
	var p = board[fr][fc];
	if(!p || p.color !== color) return false;
	var rm = grmStandalone(board, fr, fc);
	var found = false;
	for(var i=0; i<rm.length; i++) {
		if(rm[i].row === tr && rm[i].col === tc) { found = true; break; }
	}
	if(!found) return false;
	var cp = board[tr][tc];
	board[tr][tc] = p;
	board[fr][fc] = null;
	var inCheck = isKingInCheckFast(board, color);
	board[fr][fc] = p;
	board[tr][tc] = cp;
	return !inCheck;
}

function initBoard() {
	var board = [];
	for(var r=0; r<10; r++) { board[r] = []; for(var c=0; c<9; c++) board[r][c] = null; }
	board[0][0] = {type:'rook',color:'black'}; board[0][1] = {type:'horse',color:'black'};
	board[0][2] = {type:'elephant',color:'black'}; board[0][3] = {type:'advisor',color:'black'};
	board[0][4] = {type:'king',color:'black'}; board[0][5] = {type:'advisor',color:'black'};
	board[0][6] = {type:'elephant',color:'black'}; board[0][7] = {type:'horse',color:'black'};
	board[0][8] = {type:'rook',color:'black'};
	board[2][1] = {type:'cannon',color:'black'}; board[2][7] = {type:'cannon',color:'black'};
	board[3][0] = {type:'pawn',color:'black'}; board[3][2] = {type:'pawn',color:'black'};
	board[3][4] = {type:'pawn',color:'black'}; board[3][6] = {type:'pawn',color:'black'};
	board[3][8] = {type:'pawn',color:'black'};
	board[9][0] = {type:'rook',color:'red'}; board[9][1] = {type:'horse',color:'red'};
	board[9][2] = {type:'elephant',color:'red'}; board[9][3] = {type:'advisor',color:'red'};
	board[9][4] = {type:'king',color:'red'}; board[9][5] = {type:'advisor',color:'red'};
	board[9][6] = {type:'elephant',color:'red'}; board[9][7] = {type:'horse',color:'red'};
	board[9][8] = {type:'rook',color:'red'};
	board[7][1] = {type:'cannon',color:'red'}; board[7][7] = {type:'cannon',color:'red'};
	board[6][0] = {type:'pawn',color:'red'}; board[6][2] = {type:'pawn',color:'red'};
	board[6][4] = {type:'pawn',color:'red'}; board[6][6] = {type:'pawn',color:'red'};
	board[6][8] = {type:'pawn',color:'red'};
	return board;
}

function simulateMove(board, fr, fc, tr, tc) {
	board[tr][tc] = board[fr][fc];
	board[fr][fc] = null;
}

function getCurrentTurn(moveHistorySubset) {
	return moveHistorySubset.length % 2 === 0 ? 'red' : 'black';
}

function aiGetGameStage(board){
	var totalValue=0;
	for(var r=0;r<10;r++)for(var c=0;c<9;c++){var p=board[r][c];if(!p)continue;totalValue+=PV[p.type];}
	if(totalValue>2200)return"opening";else if(totalValue>1000)return"mid";else return"end";
}

function aiDetectFormationScore(board){
	var score=0;
	var redChe=[],blackChe=[],redMa=[],blackMa=[],redPao=[],blackPao=[],redBinFront=[];
	for(var r=0;r<10;r++)for(var c=0;c<9;c++){
		var p=board[r][c];if(!p)continue;
		var pt=p.type;
		if(pt==='rook'){(p.color==='red'?redChe:blackChe).push([c,r]);}
		else if(pt==='horse'){(p.color==='red'?redMa:blackMa).push([c,r]);}
		else if(pt==='cannon'){(p.color==='red'?redPao:blackPao).push([c,r]);}
		else if(pt==='pawn'&&p.color==='red'&&r<=4){redBinFront.push([c,r]);}
	}
	if(redChe.length>=2){var rc0=redChe[0],rc1=redChe[1];if(rc0[0]===rc1[0]||rc0[1]===rc1[1])score+=aiWeights.rookCoordination;}
	if(blackChe.length>=2){var bc0=blackChe[0],bc1=blackChe[1];if(bc0[0]===bc1[0]||bc0[1]===bc1[1])score-=aiWeights.rookCoordination;}
	if(redPao.length>=2)score+=FORM_SCORE.double_cannon;
	if(blackPao.length>=2)score-=FORM_SCORE.double_cannon;
	if(redMa.length>=2)score+=FORM_SCORE.double_knight;
	if(blackMa.length>=2)score-=FORM_SCORE.double_knight;
	for(var i=0;i<redChe.length;i++)for(var j=0;j<redPao.length;j++){
		if(redChe[i][0]===redPao[j][0]||redChe[i][1]===redPao[j][1]){score+=FORM_SCORE.che_pao_line;break;}
	}
	score+=FORM_SCORE.knight_cannon_mate*0.3;
	if(redBinFront.length>=3)score+=FORM_SCORE.three_bin_push;
	return score;
}

function aiDetectPinnedAndHeartHorse(board){
	var penalty=0;
	for(var r=0;r<10;r++)for(var c=0;c<9;c++){
		var p=board[r][c];if(!p||p.type!=='horse')continue;
		if(p.color==='red'&&c===4&&r===8)penalty+=TACTIC_SCORE.heart_horse_penalty;
		if(p.color==='black'&&c===4&&r===1)penalty-=TACTIC_SCORE.heart_horse_penalty;
	}
	var dirs=[[1,0],[-1,0],[0,1],[0,-1]];
	for(var r=0;r<10;r++)for(var c=0;c<9;c++){
		var p=board[r][c];if(!p)continue;
		var side=p.color==='red'?'red':'black';var pt=p.type;
		for(var d=0;d<dirs.length;d++){
			var barrier=0,step=1;
			while(true){
				var nr=r+dirs[d][0]*step,nc=c+dirs[d][1]*step;
				if(nr<0||nr>9||nc<0||nc>8)break;
				var tp=board[nr][nc];
				if(tp){
					barrier++;
					if(barrier===1){step++;continue;}
					if(barrier===2&&tp.type==='cannon'&&tp.color!==side){
						if(pt==='rook')penalty+=TACTIC_SCORE.pin_che;
						else penalty+=TACTIC_SCORE.pin_minor;
					}
					break;
				}
				step++;
			}
		}
	}
	return penalty;
}

// 3. AI state variables
var _timedOut = false;
// AI搜索节点限制
var MAX_NODES = 1000000;
var aiKillers=[],aiHistory=[],aiTT={},aiNodes=0,aiStartTime=0,aiMaxTime=5000;
var TT_EXACT=0,TT_ALPHA=1,TT_BETA=2;
(function(){for(var r=0;r<10;r++){aiHistory[r]=[];for(var c=0;c<9;c++){aiHistory[r][c]=[];for(var tr=0;tr<10;tr++){aiHistory[r][c][tr]=[];for(var tc=0;tc<9;tc++)aiHistory[r][c][tr][tc]=0;}}}})();

// 4. Piece-Square Tables
var PST={
king:[
[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,0],[1,1,2,2,3,2,2,1,1],[1,2,3,4,4,4,3,2,1],[1,2,3,4,5,4,3,2,1]],
advisor:[
[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,1],[0,2,0,3,0,3,0,2,0],[0,0,0,0,4,0,0,0,0]],
elephant:[
[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,2,0,0,0,0,0,2,0],
[0,0,0,0,0,0,0,0,0],[2,0,4,0,0,0,4,0,2],[0,0,0,0,0,0,0,0,0],[0,0,2,0,0,0,2,0,0]],
horse:[
[0,0,0,0,0,0,0,0,0],[0,0,1,0,2,0,1,0,0],[0,1,0,2,0,2,0,1,0],
[0,0,2,0,4,0,2,0,0],[0,1,0,3,0,3,0,1,0],[0,0,2,0,4,0,2,0,0],
[0,1,0,2,0,2,0,1,0],[0,0,1,0,2,0,1,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0]],
rook:[
[6,6,6,8,10,8,6,6,6],[6,8,8,10,12,10,8,8,6],[6,8,8,10,12,10,8,8,6],
[6,8,8,10,12,10,8,8,6],[4,6,6,8,10,8,6,6,4],[4,6,6,8,10,8,6,6,4],
[4,6,6,8,10,8,6,6,4],[4,6,6,8,10,8,6,6,4],[4,6,6,8,10,8,6,6,4],[4,4,4,6,8,6,4,4,4]],
cannon:[
[4,4,4,5,6,5,4,4,4],[4,5,5,6,7,6,5,5,4],[4,5,5,6,7,6,5,5,4],
[4,6,6,7,8,7,6,6,4],[4,6,6,7,8,7,6,6,4],[4,6,6,7,8,7,6,6,4],
[4,6,6,7,8,7,6,6,4],[4,5,5,6,7,6,5,5,4],[4,5,5,6,7,6,5,5,4],[3,4,4,5,6,5,4,4,3]],
pawn:[
[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],
[2,0,2,0,4,0,2,0,2],[4,4,6,0,8,0,6,4,4],[6,8,12,0,16,0,12,8,6],[10,16,24,0,32,0,24,16,10]]
};

function getPST(p,r,c){
	var mul=p.color==='black'?1:-1;
	if(p.type==='horse')return mul*MA_PST_TABLE[r][c];
	if(p.type==='rook')return mul*CHE_PST_TABLE[r][c];
	if(p.type==='cannon')return mul*PAO_PST_TABLE[r][c];
	if(p.type==='pawn')return mul*BIN_PST_TABLE[r][c];
	return 0;
}
function boardKey(board,turn){var k=turn;for(var r=0;r<10;r++)for(var c=0;c<9;c++){var p=board[r][c];k+=p?p.color[0]+p.type[0]:'..';}return k;}

var openingBook={
	"R7,1,7,4": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R7,1,7,4|B9,1,7,2": [
		{
			"fromRow": 9,
			"fromCol": 1,
			"toRow": 7,
			"toCol": 2
		},
		{
			"fromRow": 9,
			"fromCol": 7,
			"toRow": 7,
			"toCol": 6
		},
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,8,9,7": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,8,9,7|R9,0,9,1": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,7,7,6": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 9,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 0
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,7,7,6|R6,6,5,6": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,7,7,6|R6,6,5,6|B6,6,5,6": [
		{
			"fromRow": 9,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 0
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,7,7,6|R6,6,5,6|B6,6,5,6|R9,0,3,0": [
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,7,7,6|R6,6,5,6|B6,6,5,6|R9,0,3,0|B7,7,7,8": [
		{
			"fromRow": 9,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 0
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,7,7,6|R6,6,5,6|B6,6,5,6|R9,0,3,0|B7,7,7,8|R3,0,3,2": [
		{
			"fromRow": 2,
			"fromCol": 8,
			"toRow": 3,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,7,7,6|R6,6,5,6|B6,6,5,6|R9,0,3,0|B7,7,7,8|R3,0,3,2|B7,8,7,7": [
		{
			"fromRow": 9,
			"fromCol": 7,
			"toRow": 7,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,7,7,6|R6,6,5,6|B6,6,5,6|R9,0,3,0|B7,7,7,8|R3,0,3,2|B7,8,7,7|R9,7,7,6": [
		{
			"fromRow": 0,
			"fromCol": 3,
			"toRow": 1,
			"toCol": 4
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,7,7,6|R6,6,5,6|B6,6,5,6|R9,0,3,0|B7,7,7,8|R3,0,3,2|B7,8,7,7|R9,7,7,6|B9,3,8,4": [
		{
			"fromRow": 7,
			"fromCol": 6,
			"toRow": 6,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,7,7,6|R6,6,5,6|B6,6,5,6|R9,0,3,0|B7,7,7,8|R3,0,3,2|B7,8,7,7|R9,7,7,6|B9,3,8,4|R7,6,6,5": [
		{
			"fromRow": 3,
			"fromCol": 7,
			"toRow": 3,
			"toCol": 5
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,7,7,6|R6,6,5,6|B6,6,5,6|R9,0,3,0|B7,7,7,8|R3,0,3,2|B7,8,7,7|R9,7,7,6|B9,3,8,4|R7,6,6,5|B7,7,7,5": [
		{
			"fromRow": 3,
			"fromCol": 2,
			"toRow": 3,
			"toCol": 3
		},
		{
			"fromRow": 9,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,7,7,6|R6,6,5,6|B6,6,5,6|R9,0,3,0|B7,7,7,8|R3,0,3,2|B7,8,7,7|R9,7,7,6|B9,3,8,4|R7,6,6,5|B7,7,7,5|R3,2,3,3": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 3,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,7,7,6|R9,0,9,1|B9,8,9,7|R9,0,3,0|B6,6,5,6|R6,6,5,6|B7,7,7,8|R3,0,3,2|B7,8,7,7|R9,7,7,6|B9,3,8,4|R7,7,7,8|B7,7,7,5|R3,2,3,3|B0,0,0,2": [
		{
			"fromRow": 7,
			"fromCol": 6,
			"toRow": 6,
			"toCol": 6
		},
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 6,
			"toCol": 5
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,7,7,6|R9,0,9,1|B9,8,9,7|R9,0,3,0|B6,6,5,6|R6,6,5,6|B7,7,7,8|R3,0,3,2|B7,8,7,7|R9,7,7,6|B9,3,8,4|R7,7,7,8|B7,7,7,5|R3,2,3,3|B0,0,0,2|R7,6,6,5": [
		{
			"fromRow": 3,
			"fromCol": 7,
			"toRow": 3,
			"toCol": 5
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,7,7,6|R9,0,9,1|B9,8,9,7|R9,0,3,0|B6,6,5,6|R6,6,5,6|B7,7,7,8|R3,0,3,2|B7,8,7,7|R9,7,7,6|B9,3,8,4|R7,7,7,8|B7,7,7,5|R3,2,3,3|B0,0,0,2|R7,6,6,5|B3,7,3,5": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 6,
			"toCol": 5
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,7,7,6|R9,0,9,1|B9,8,9,7|R9,7,7,6|B6,6,5,6|R9,0,3,0|B6,4,5,4|R6,6,5,6|B9,8,9,7|R9,7,7,6|B7,7,7,8|R3,0,3,2|B7,8,7,7|R7,6,6,5|B9,3,8,4|R7,7,7,5|B7,7,7,5": [
		{
			"fromRow": 3,
			"fromCol": 2,
			"toRow": 2,
			"toCol": 3
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,7,7,6|R9,0,9,1|B9,8,9,7|R9,7,7,6|B6,6,5,6|R9,0,3,0|B6,4,5,4|R6,6,5,6|B9,8,9,7|R9,7,7,6|B7,7,7,8|R3,0,3,2|B7,8,7,7|R7,6,6,5|B9,3,8,4|R7,7,7,5|B7,7,7,5|R3,2,3,3": [
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B9,1,7,2|R9,1,7,2|B9,7,7,6|R9,0,9,1|B9,8,9,7|R9,0,3,0|B6,6,5,6|R6,2,5,2|B6,4,5,4|R9,7,7,6|B7,7,7,8|R7,7,7,6|B9,6,9,3|R7,6,6,5|B7,8,7,7|R3,0,3,2|B9,3,8,4|R7,7,7,5|B7,7,7,5": [
		{
			"fromRow": 3,
			"fromCol": 2,
			"toRow": 2,
			"toCol": 3
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B7,1,7,4": [
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		}
	],
	"R7,1,7,4|B7,1,7,4|R0,1,2,2": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R7,1,7,4|B7,7,7,4": [
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,1,7,2": [
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,1,7,2|B9,8,9,7": [
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,1,7,2|B9,8,9,7|R9,0,9,1": [
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,1,7,2": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,1,7,2|R6,6,5,6": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,1,7,2|R6,6,5,6|B9,7,7,6": [
		{
			"fromRow": 9,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 0
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,0,3,0": [
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,0,3,0|B7,7,7,6": [
		{
			"fromRow": 9,
			"fromCol": 7,
			"toRow": 7,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,0,3,0|B7,7,7,6|R9,7,7,6": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,0,3,0|B7,7,7,6|R9,7,7,6|B6,6,5,6": [
		{
			"fromRow": 9,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 0
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,0,3,0|B7,7,7,6|R9,7,7,6|B6,6,5,6|R9,0,3,2": [
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,0,3,0|B7,7,7,6|R9,7,7,6|B6,6,5,6|R9,0,3,2|B7,7,7,8": [
		{
			"fromRow": 9,
			"fromCol": 7,
			"toRow": 7,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,0,3,0|B7,7,7,6|R9,7,7,6|B6,6,5,6|R9,0,3,2|B7,7,7,8|R9,7,7,8": [
		{
			"fromRow": 2,
			"fromCol": 8,
			"toRow": 3,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,1,7,2|B9,8,9,7|R9,0,9,1|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,0,3,0|B7,7,7,6|R9,7,7,6|B6,6,5,6|R9,0,3,2|B7,7,7,8|R9,7,7,8|B7,8,7,7": [
		{
			"fromRow": 9,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 0
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,0,9,1": [
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,0,9,1|B9,1,7,2": [
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,0,9,1|B9,1,7,2|R9,1,7,2": [
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,0,9,1|B9,1,7,2|R9,1,7,2|B9,8,9,7": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,0,9,1|B9,1,7,2|R9,1,7,2|B9,8,9,7|R6,6,5,6": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,0,9,1|B9,1,7,2|R9,1,7,2|B9,8,9,7|R6,6,5,6|B9,7,7,6": [
		{
			"fromRow": 9,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 0
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,0,9,1|B9,1,7,2|R9,1,7,2|B9,8,9,7|R6,6,5,6|B9,7,7,6|R9,0,3,0": [
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,0,9,1|B9,1,7,2|R9,1,7,2|B9,8,9,7|R6,6,5,6|B9,7,7,6|R9,0,3,0|B7,7,7,6": [
		{
			"fromRow": 9,
			"fromCol": 7,
			"toRow": 7,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,0,9,1|B9,1,7,2|R9,1,7,2|B9,8,9,7|R6,6,5,6|B9,7,7,6|R9,0,3,0|B7,7,7,6|R9,7,7,6": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,0,9,1|B9,1,7,2|R9,1,7,2|B9,8,9,7|R6,6,5,6|B9,7,7,6|R9,0,3,0|B7,7,7,6|R9,7,7,6|B6,6,5,6": [
		{
			"fromRow": 9,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 0
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,0,9,1|B9,1,7,2|R9,1,7,2|B9,8,9,7|R6,6,5,6|B9,7,7,6|R9,0,3,0|B7,7,7,6|R9,7,7,6|B6,6,5,6|R9,0,3,2": [
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,0,9,1|B9,1,7,2|R9,1,7,2|B9,8,9,7|R6,6,5,6|B9,7,7,6|R9,0,3,0|B7,7,7,6|R9,7,7,6|B6,6,5,6|R9,0,3,2|B7,7,7,8": [
		{
			"fromRow": 9,
			"fromCol": 7,
			"toRow": 7,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R7,1,7,4|B7,7,7,4|R9,0,9,1|B9,1,7,2|R9,1,7,2|B9,8,9,7|R6,6,5,6|B9,7,7,6|R9,0,3,0|B7,7,7,6|R9,7,7,6|B6,6,5,6|R9,0,3,2|B7,7,7,8|R9,7,7,8": [
		{
			"fromRow": 2,
			"fromCol": 8,
			"toRow": 3,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,1,7,2": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,1,7,2|B9,7,7,6": [
		{
			"fromRow": 7,
			"fromCol": 1,
			"toRow": 7,
			"toCol": 4
		},
		{
			"fromRow": 7,
			"fromCol": 7,
			"toRow": 7,
			"toCol": 4
		},
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		}
	],
	"R9,1,7,2|B9,7,7,6|R7,1,7,4": [
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,1,7,2": [
		{
			"fromRow": 9,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 0
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,1,7,2|R9,0,9,1": [
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,1,7,2|R9,0,9,1|B9,8,9,7": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,1,7,2|R9,0,9,1|B9,8,9,7|R9,0,3,0": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,1,7,2|R9,0,9,1|B9,8,9,7|R9,0,3,0|B6,6,5,6": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,1,7,2|R9,0,9,1|B9,8,9,7|R9,0,3,0|B6,6,5,6|R6,6,5,6": [
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,1,7,2|R9,0,9,1|B9,8,9,7|R9,0,3,0|B6,6,5,6|R6,6,5,6|B7,7,7,8": [
		{
			"fromRow": 9,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 0
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,1,7,2|R9,0,9,1|B9,8,9,7|R9,0,3,0|B6,6,5,6|R6,6,5,6|B7,7,7,8|R9,0,3,2": [
		{
			"fromRow": 2,
			"fromCol": 8,
			"toRow": 3,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,1,7,2|R9,0,9,1|B9,8,9,7|R9,0,3,0|B6,6,5,6|R6,6,5,6|B7,7,7,8|R9,0,3,2|B7,8,7,7": [
		{
			"fromRow": 9,
			"fromCol": 7,
			"toRow": 7,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,1,7,2|R9,0,9,1|B9,8,9,7|R9,0,3,0|B6,6,5,6|R6,6,5,6|B7,7,7,8|R9,0,3,2|B7,8,7,7|R9,7,7,6": [
		{
			"fromRow": 0,
			"fromCol": 3,
			"toRow": 1,
			"toCol": 4
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,1,7,2|R9,0,9,1|B9,8,9,7|R9,0,3,0|B6,6,5,6|R6,6,5,6|B7,7,7,8|R9,0,3,2|B7,8,7,7|R9,7,7,6|B9,3,8,4": [
		{
			"fromRow": 7,
			"fromCol": 6,
			"toRow": 6,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,1,7,2|R9,0,9,1|B9,8,9,7|R9,0,3,0|B6,6,5,6|R6,6,5,6|B7,7,7,8|R9,0,3,2|B7,8,7,7|R9,7,7,6|B9,3,8,4|R7,6,6,5": [
		{
			"fromRow": 3,
			"fromCol": 7,
			"toRow": 3,
			"toCol": 5
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,1,7,2|R9,0,9,1|B9,8,9,7|R6,2,5,2|B6,4,5,4|R9,0,3,0|B6,6,5,6|R9,7,7,6|B7,7,7,8|R9,0,3,2|B7,8,7,7|R9,7,7,8|B7,7,7,5|R3,2,3,3": [
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 1
		}
	],
	"R9,7,7,6": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,7,7,6|B9,1,7,2": [
		{
			"fromRow": 7,
			"fromCol": 7,
			"toRow": 7,
			"toCol": 4
		},
		{
			"fromRow": 7,
			"fromCol": 1,
			"toRow": 7,
			"toCol": 4
		},
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		}
	],
	"R9,7,7,6|B9,1,7,2|R7,7,7,4": [
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,7,7,6|B9,1,7,2|R7,7,7,4|B9,7,7,6": [
		{
			"fromRow": 9,
			"fromCol": 8,
			"toRow": 8,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,7,7,6|B9,1,7,2|R7,7,7,4|B9,7,7,6|R9,8,9,7": [
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,7,7,6|B9,1,7,2|R7,7,7,4|B9,7,7,6|R9,8,9,7|B9,8,9,7": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,7,7,6|B9,1,7,2|R7,7,7,4|B9,7,7,6|R9,8,9,7|B9,8,9,7|R9,8,3,8": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,7,7,6|B9,1,7,2|R7,7,7,4|B9,7,7,6|R9,8,9,7|B9,8,9,7|R9,8,3,8|B6,6,5,6": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,7,7,6|B9,1,7,2|R7,7,7,4|B9,7,7,6|R9,8,9,7|B9,8,9,7|R9,8,3,8|B6,6,5,6|R6,6,5,6": [
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,7,7,6|B9,1,7,2|R7,7,7,4|B9,7,7,6|R9,8,9,7|B9,8,9,7|R9,8,3,8|B6,6,5,6|R6,6,5,6|B7,7,7,8": [
		{
			"fromRow": 9,
			"fromCol": 8,
			"toRow": 8,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,7,7,6|B9,1,7,2|R7,7,7,4|B9,7,7,6|R9,8,9,7|B9,8,9,7|R9,8,3,8|B6,6,5,6|R6,6,5,6|B7,7,7,8|R9,8,3,2": [
		{
			"fromRow": 2,
			"fromCol": 8,
			"toRow": 3,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,7,7,6|B9,1,7,2|R7,7,7,4|B9,7,7,6|R9,8,9,7|B9,8,9,7|R9,8,3,8|B6,6,5,6|R6,6,5,6|B7,7,7,8|R9,8,3,2|B7,8,7,7": [
		{
			"fromRow": 7,
			"fromCol": 8,
			"toRow": 8,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,7,7,6|B9,1,7,2|R7,7,7,4|B9,7,7,6|R9,8,9,7|B9,8,9,7|R9,8,3,8|B6,6,5,6|R6,6,5,6|B7,7,7,8|R9,8,3,2|B7,8,7,7|R9,1,7,7": [
		{
			"fromRow": 0,
			"fromCol": 3,
			"toRow": 1,
			"toCol": 4
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,7,7,6|B9,1,7,2|R7,7,7,4|B9,7,7,6|R9,8,9,7|B9,8,9,7|R9,8,3,8|B6,6,5,6|R6,6,5,6|B7,7,7,8|R9,8,3,2|B7,8,7,7|R9,1,7,7|B9,3,8,4": [
		{
			"fromRow": 7,
			"fromCol": 8,
			"toRow": 8,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,7,7,6|B9,1,7,2|R7,7,7,4|B9,7,7,6|R9,8,9,7|B9,8,9,7|R9,8,3,8|B6,6,5,6|R6,6,5,6|B7,7,7,8|R9,8,3,2|B7,8,7,7|R9,1,7,7|B9,3,8,4|R9,1,8,7": [
		{
			"fromRow": 3,
			"fromCol": 7,
			"toRow": 3,
			"toCol": 5
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,6,7,4": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,6,7,4|B9,1,7,2": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 7,
			"fromCol": 1,
			"toRow": 7,
			"toCol": 4
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,6,7,4|B9,1,7,2|R6,6,5,6": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,6,7,4|B9,1,7,2|R6,6,5,6|B9,7,7,6": [
		{
			"fromRow": 7,
			"fromCol": 7,
			"toRow": 7,
			"toCol": 4
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,6,7,4|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,1,7,2": [
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,6,7,4|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,1,7,2|B9,8,9,7": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,6,7,4|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,1,7,2|B9,8,9,7|R9,0,9,1": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,6,7,4|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,1,7,2|B9,8,9,7|R9,0,9,1|B6,6,5,6": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,6,7,4|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,1,7,2|B9,8,9,7|R9,0,9,1|B6,6,5,6|R9,0,3,0": [
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,6,7,4|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,1,7,2|B9,8,9,7|R9,0,9,1|B6,6,5,6|R9,0,3,0|B7,7,7,8": [
		{
			"fromRow": 9,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 0
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,6,7,4|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,1,7,2|B9,8,9,7|R9,0,9,1|B6,6,5,6|R9,0,3,0|B7,7,7,8|R9,0,3,2": [
		{
			"fromRow": 2,
			"fromCol": 8,
			"toRow": 3,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,6,7,4|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,1,7,2|B9,8,9,7|R9,0,9,1|B6,6,5,6|R9,0,3,0|B7,7,7,8|R9,0,3,2|B7,8,7,7": [
		{
			"fromRow": 9,
			"fromCol": 7,
			"toRow": 7,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,6,7,4|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,1,7,2|B9,8,9,7|R9,0,9,1|B6,6,5,6|R9,0,3,0|B7,7,7,8|R9,0,3,2|B7,8,7,7|R9,7,7,6": [
		{
			"fromRow": 0,
			"fromCol": 3,
			"toRow": 1,
			"toCol": 4
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,6,7,4|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,1,7,2|B9,8,9,7|R9,0,9,1|B6,6,5,6|R9,0,3,0|B7,7,7,8|R9,0,3,2|B7,8,7,7|R9,7,7,6|B9,3,8,4": [
		{
			"fromRow": 7,
			"fromCol": 6,
			"toRow": 6,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,6,7,4|B9,1,7,2|R6,6,5,6|B9,7,7,6|R9,1,7,2|B9,8,9,7|R9,0,9,1|B6,6,5,6|R9,0,3,0|B7,7,7,8|R9,0,3,2|B7,8,7,7|R9,7,7,6|B9,3,8,4|R7,6,6,5": [
		{
			"fromRow": 3,
			"fromCol": 7,
			"toRow": 3,
			"toCol": 5
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,6,7,4|B7,7,7,4": [
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		}
	],
	"R9,6,7,4|B7,7,7,4|R9,1,7,2": [
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,6,7,4|B7,7,7,4|R9,1,7,2|B9,1,7,2": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,6,7,4|B7,7,7,4|R9,1,7,2|B9,1,7,2|R7,1,7,4": [
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,2,7,4": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,2,7,4|B9,1,7,2": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 7,
			"fromCol": 7,
			"toRow": 7,
			"toCol": 4
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,2,7,4|B9,1,7,2|R9,7,7,6": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,2,7,4|B9,1,7,2|R9,7,7,6|B9,7,7,6": [
		{
			"fromRow": 7,
			"fromCol": 1,
			"toRow": 7,
			"toCol": 4
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,2,7,4|B9,1,7,2|R9,7,7,6|B9,7,7,6|R6,6,5,6": [
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R9,2,7,4|B9,1,7,2|R9,7,7,6|B9,7,7,6|R6,6,5,6|B9,8,9,7": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,2,7,4|B9,1,7,2|R9,7,7,6|B9,7,7,6|R6,6,5,6|B9,8,9,7|R9,8,9,7": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,2,7,4|B9,1,7,2|R9,7,7,6|B9,7,7,6|R6,6,5,6|B9,8,9,7|R9,8,9,7|B6,6,5,6": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,2,7,4|B9,1,7,2|R9,7,7,6|B9,7,7,6|R6,6,5,6|B9,8,9,7|R9,8,9,7|B6,6,5,6|R9,8,3,8": [
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,2,7,4|B9,1,7,2|R9,7,7,6|B9,7,7,6|R6,6,5,6|B9,8,9,7|R9,8,9,7|B6,6,5,6|R9,8,3,8|B7,7,7,8": [
		{
			"fromRow": 9,
			"fromCol": 8,
			"toRow": 8,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,2,7,4|B9,1,7,2|R9,7,7,6|B9,7,7,6|R6,6,5,6|B9,8,9,7|R9,8,9,7|B6,6,5,6|R9,8,3,8|B7,7,7,8|R9,8,3,2": [
		{
			"fromRow": 2,
			"fromCol": 8,
			"toRow": 3,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,2,7,4|B9,1,7,2|R9,7,7,6|B9,7,7,6|R6,6,5,6|B9,8,9,7|R9,8,9,7|B6,6,5,6|R9,8,3,8|B7,7,7,8|R9,8,3,2|B7,8,7,7": [
		{
			"fromRow": 7,
			"fromCol": 8,
			"toRow": 8,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,2,7,4|B9,1,7,2|R9,7,7,6|B9,7,7,6|R6,6,5,6|B9,8,9,7|R9,8,9,7|B6,6,5,6|R9,8,3,8|B7,7,7,8|R9,8,3,2|B7,8,7,7|R9,1,7,7": [
		{
			"fromRow": 0,
			"fromCol": 3,
			"toRow": 1,
			"toCol": 4
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,2,7,4|B9,1,7,2|R9,7,7,6|B9,7,7,6|R6,6,5,6|B9,8,9,7|R9,8,9,7|B6,6,5,6|R9,8,3,8|B7,7,7,8|R9,8,3,2|B7,8,7,7|R9,1,7,7|B9,3,8,4": [
		{
			"fromRow": 7,
			"fromCol": 8,
			"toRow": 8,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,2,7,4|B9,1,7,2|R9,7,7,6|B9,7,7,6|R6,6,5,6|B9,8,9,7|R9,8,9,7|B6,6,5,6|R9,8,3,8|B7,7,7,8|R9,8,3,2|B7,8,7,7|R9,1,7,7|B9,3,8,4|R9,1,8,7": [
		{
			"fromRow": 3,
			"fromCol": 7,
			"toRow": 3,
			"toCol": 5
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R9,2,7,4|B7,7,7,4": [
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		}
	],
	"R9,2,7,4|B7,7,7,4|R9,7,7,6": [
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R6,6,5,6|B9,1,7,2": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 7,
			"fromCol": 1,
			"toRow": 7,
			"toCol": 4
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R6,6,5,6|B9,1,7,2|R9,1,7,2": [
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R6,6,5,6|B9,1,7,2|R9,1,7,2|B9,7,7,6": [
		{
			"fromRow": 7,
			"fromCol": 7,
			"toRow": 7,
			"toCol": 4
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R6,6,5,6|B9,1,7,2|R9,1,7,2|B9,7,7,6|R7,1,7,4": [
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R6,6,5,6|B9,1,7,2|R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,8,9,7": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B9,1,7,2|R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,8,9,7|R9,0,9,1": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B9,1,7,2|R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,8,9,7|R9,0,9,1|B6,6,5,6": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B9,1,7,2|R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,8,9,7|R9,0,9,1|B6,6,5,6|R9,0,3,0": [
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B9,1,7,2|R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,8,9,7|R9,0,9,1|B6,6,5,6|R9,0,3,0|B7,7,7,8": [
		{
			"fromRow": 9,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 0
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B9,1,7,2|R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,8,9,7|R9,0,9,1|B6,6,5,6|R9,0,3,0|B7,7,7,8|R9,0,3,2": [
		{
			"fromRow": 2,
			"fromCol": 8,
			"toRow": 3,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B9,1,7,2|R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,8,9,7|R9,0,9,1|B6,6,5,6|R9,0,3,0|B7,7,7,8|R9,0,3,2|B7,8,7,7": [
		{
			"fromRow": 9,
			"fromCol": 7,
			"toRow": 7,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B9,1,7,2|R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,8,9,7|R9,0,9,1|B6,6,5,6|R9,0,3,0|B7,7,7,8|R9,0,3,2|B7,8,7,7|R9,7,7,6": [
		{
			"fromRow": 0,
			"fromCol": 3,
			"toRow": 1,
			"toCol": 4
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B9,1,7,2|R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,8,9,7|R9,0,9,1|B6,6,5,6|R9,0,3,0|B7,7,7,8|R9,0,3,2|B7,8,7,7|R9,7,7,6|B9,3,8,4": [
		{
			"fromRow": 7,
			"fromCol": 6,
			"toRow": 6,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B9,1,7,2|R9,1,7,2|B9,7,7,6|R7,1,7,4|B9,8,9,7|R9,0,9,1|B6,6,5,6|R9,0,3,0|B7,7,7,8|R9,0,3,2|B7,8,7,7|R9,7,7,6|B9,3,8,4|R7,6,6,5": [
		{
			"fromRow": 3,
			"fromCol": 7,
			"toRow": 3,
			"toCol": 5
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B2,7,2,4": [
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		}
	],
	"R6,6,5,6|B2,7,2,4|R9,1,7,2": [
		{
			"fromRow": 0,
			"fromCol": 1,
			"toRow": 2,
			"toCol": 2
		},
		{
			"fromRow": 0,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B2,7,2,4|R9,1,7,2|B9,1,7,2": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		},
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 4
		}
	],
	"R6,6,5,6|B2,7,2,4|R9,1,7,2|B9,1,7,2|R9,6,7,4": [
		{
			"fromRow": 0,
			"fromCol": 8,
			"toRow": 0,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B2,7,2,4|R9,1,7,2|B9,1,7,2|R9,6,7,4|B9,8,9,7": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B2,7,2,4|R9,1,7,2|B9,1,7,2|R9,6,7,4|B9,8,9,7|R9,0,9,1": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B2,7,2,4|R9,1,7,2|B9,1,7,2|R9,6,7,4|B9,8,9,7|R9,0,9,1|B9,7,7,6": [
		{
			"fromRow": 6,
			"fromCol": 6,
			"toRow": 5,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B2,7,2,4|R9,1,7,2|B9,1,7,2|R9,6,7,4|B9,8,9,7|R9,0,9,1|B9,7,7,6|R9,0,3,0": [
		{
			"fromRow": 2,
			"fromCol": 7,
			"toRow": 2,
			"toCol": 8
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B2,7,2,4|R9,1,7,2|B9,1,7,2|R9,6,7,4|B9,8,9,7|R9,0,9,1|B9,7,7,6|R9,0,3,0|B7,7,7,8": [
		{
			"fromRow": 9,
			"fromCol": 0,
			"toRow": 0,
			"toCol": 0
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B2,7,2,4|R9,1,7,2|B9,1,7,2|R9,6,7,4|B9,8,9,7|R9,0,9,1|B9,7,7,6|R9,0,3,0|B7,7,7,8|R9,0,3,2": [
		{
			"fromRow": 2,
			"fromCol": 8,
			"toRow": 3,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B2,7,2,4|R9,1,7,2|B9,1,7,2|R9,6,7,4|B9,8,9,7|R9,0,9,1|B9,7,7,6|R9,0,3,0|B7,7,7,8|R9,0,3,2|B7,8,7,7": [
		{
			"fromRow": 9,
			"fromCol": 7,
			"toRow": 7,
			"toCol": 7
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B2,7,2,4|R9,1,7,2|B9,1,7,2|R9,6,7,4|B9,8,9,7|R9,0,9,1|B9,7,7,6|R9,0,3,0|B7,7,7,8|R9,0,3,2|B7,8,7,7|R9,7,7,6": [
		{
			"fromRow": 0,
			"fromCol": 3,
			"toRow": 1,
			"toCol": 4
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B2,7,2,4|R9,1,7,2|B9,1,7,2|R9,6,7,4|B9,8,9,7|R9,0,9,1|B9,7,7,6|R9,0,3,0|B7,7,7,8|R9,0,3,2|B7,8,7,7|R9,7,7,6|B9,3,8,4": [
		{
			"fromRow": 7,
			"fromCol": 6,
			"toRow": 6,
			"toCol": 6
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	],
	"R6,6,5,6|B2,7,2,4|R9,1,7,2|B9,1,7,2|R9,6,7,4|B9,8,9,7|R9,0,9,1|B9,7,7,6|R9,0,3,0|B7,7,7,8|R9,0,3,2|B7,8,7,7|R9,7,7,6|B9,3,8,4|R7,6,6,5": [
		{
			"fromRow": 3,
			"fromCol": 7,
			"toRow": 3,
			"toCol": 5
		},
		{
			"fromRow": 0,
			"fromCol": 0,
			"toRow": 1,
			"toCol": 0
		}
	]
};



// 5. Standalone lookupOpeningBook
function lookupOpeningBook(board, moveHistory, aiCl){
	var standardOpenings = ['R7,1,7,4','R6,6,5,6','R9,1,7,2','R9,7,7,6','R9,6,7,4','R9,2,7,4'];
	if(moveHistory.length === 0){
		console.log('=== Worker lookupOpeningBook: first move, aiCl='+aiCl+' ===');
		var firstMoves = [];
		var cannonMove = null;
		for(var bk in openingBook){
			if(bk.indexOf('|') === -1 && bk.charAt(0) === 'R' && standardOpenings.indexOf(bk) !== -1){
				var pts = bk.substring(1).split(',');
				var fr = parseInt(pts[0]), fc = parseInt(pts[1]);
				var tr = parseInt(pts[2]), tc = parseInt(pts[3]);
				var p = board[fr][fc];
				console.log('  Checking book key:', bk, '-> from('+fr+','+fc+') to('+tr+','+tc+')');
				console.log('  Piece at from:', p ? p.type + ':' + p.color : 'null');
				if(p && p.color === aiCl){
					var rm = grmStandalone(board, fr, fc);
					console.log('  Valid moves from this position:', JSON.stringify(rm));
					var found = false;
					for(var i=0; i<rm.length; i++){
						if(rm[i].row === tr && rm[i].col === tc){ found = true; break; }
					}
					if(found){
						var move = {fromRow:fr, fromCol:fc, toRow:tr, toCol:tc};
						if(bk === 'R7,1,7,4'){
							cannonMove = move;
						}
						firstMoves.push(move);
						console.log('  Found valid opening move:', bk);
					} else {
						console.log('  Move not in valid moves, skipping:', bk);
					}
				} else {
					console.log('  Piece color mismatch or null, skipping:', bk);
				}
			}
		}
		console.log('  Total valid opening moves:', firstMoves.length);
		if(cannonMove){
			cannonMove.piece = board[cannonMove.fromRow][cannonMove.fromCol];
			cannonMove.captured = board[cannonMove.toRow][cannonMove.toCol];
			console.log('  Returning cannon move:', JSON.stringify(cannonMove));
			return cannonMove;
		}
		if(firstMoves.length > 0){
			var selected = firstMoves[Math.floor(Math.random() * firstMoves.length)];
			selected.piece = board[selected.fromRow][selected.fromCol];
			selected.captured = board[selected.toRow][selected.toCol];
			console.log('  Returning random opening move:', JSON.stringify(selected));
			return selected;
		}
		console.log('  No valid opening moves found, returning null');
		return null;
	}
	var keyParts = [];
	for(var i = 0; i < moveHistory.length; i++){
		var m = moveHistory[i];
		var isRedMove = m.piece && m.piece.color === 'red';
		if(isRedMove){
			keyParts.push('R' + m.fromRow + ',' + m.fromCol + ',' + m.toRow + ',' + m.toCol);
		} else {
			keyParts.push('B' + (9 - m.fromRow) + ',' + m.fromCol + ',' + (9 - m.toRow) + ',' + m.toCol);
		}
	}
	for(var kLen = keyParts.length; kLen >= 1; kLen--){
		var tempBoard = initBoard();
		for(var i = 0; i < kLen; i++){
			var step = moveHistory[i];
			simulateMove(tempBoard, step.fromRow, step.fromCol, step.toRow, step.toCol);
		}
		var responseColor = tempBoard.currentTurn;
		var key = keyParts.slice(0, kLen).join('|');
		var bookMoves = openingBook[key];
		var useMirror = false;
		if(!bookMoves){
			var mirrorParts = [];
			for(var i = 0; i < kLen; i++){
				var seg = keyParts[i].split(',');
				var fr = seg[0], fc = 8 - Number(seg[1]), tr = seg[2], tc = 8 - Number(seg[3]);
				mirrorParts.push(fr+','+fc+','+tr+','+tc);
			}
			var mirrorKey = mirrorParts.join('|');
			bookMoves = openingBook[mirrorKey];
			useMirror = !!bookMoves;
		}
		if(!bookMoves) continue;
		var validBookMoves = [];
		for(var i = 0; i < bookMoves.length; i++){
			var mv = bookMoves[i];
			var realMove = {fromRow: mv.fromRow, fromCol: mv.fromCol, toRow: mv.toRow, toCol: mv.toCol};
			if(useMirror){
				realMove.fromCol = 8 - realMove.fromCol;
				realMove.toCol = 8 - realMove.toCol;
			}
			var pieceAtFrom = tempBoard[realMove.fromRow][realMove.fromCol];
			if(!pieceAtFrom || pieceAtFrom.color !== responseColor){
				continue;
			}
			if(isMoveLegal(tempBoard, realMove.fromRow, realMove.fromCol, realMove.toRow, realMove.toCol, responseColor)){
				validBookMoves.push(realMove);
			}
		}
		if(validBookMoves.length === 0) continue;
		validBookMoves.sort(function(a,b){
			var scoreA = 0, scoreB = 0;
			var pieceA = tempBoard[a.fromRow][a.fromCol];
			var pieceB = tempBoard[b.fromRow][b.fromCol];
			if(pieceA && (pieceA.type === 'cannon' || pieceA.type === 'horse' || pieceA.type === 'rook')) scoreA += 3;
			if(pieceB && (pieceB.type === 'cannon' || pieceB.type === 'horse' || pieceB.type === 'rook')) scoreB += 3;
			var forwardColor = responseColor;
			if(forwardColor === 'black'){
				if(a.toRow >= 5) scoreA += 2;
				if(b.toRow >= 5) scoreB += 2;
			}else{
				if(a.toRow <= 4) scoreA += 2;
				if(b.toRow <= 4) scoreB += 2;
			}
			return scoreB - scoreA;
		});
		var pickMax = Math.min(3, validBookMoves.length);
		var selected = validBookMoves[Math.floor(Math.random() * pickMax)];
		selected.piece = tempBoard[selected.fromRow][selected.fromCol];
		selected.captured = tempBoard[selected.toRow][selected.toCol];
		return selected;
	}
	return null;
}

// 6. Phase calculation
function aiGetPhase(board){
	var totalPcs=0, majorPcs=0;
	for(var r=0;r<10;r++)for(var c=0;c<9;c++){
		var p=board[r][c];if(!p)continue;totalPcs++;
		if(p.type==='rook'||p.type==='cannon'||p.type==='horse')majorPcs++;
	}
	if(totalPcs>=28)return 0;if(totalPcs>=16)return 1;return 2;
}

// 7. Midgame/Endgame library
var mgEgLib={};
function lookupMgEgLib(board, aiCl){
	var phase=aiGetPhase(board);
	if(phase<2)return null;
	if(aiCl!=='black')return null;
	var key=boardKey(board,'black');
	if(mgEgLib[key])return mgEgLib[key][Math.floor(Math.random()*mgEgLib[key].length)];
	var bPcs=[],rPcs=[],bRook=null,bCannon=null,bPawns=[],rKing=null,bKing=null;
	for(var r=0;r<10;r++)for(var c=0;c<9;c++){
		var p=board[r][c];if(!p)continue;
		if(p.color==='black'){
			bPcs.push({type:p.type,row:r,col:c});
			if(p.type==='rook')bRook={row:r,col:c};
			if(p.type==='cannon')bCannon={row:r,col:c};
			if(p.type==='pawn')bPawns.push({row:r,col:c});
			if(p.type==='king')bKing={row:r,col:c};
		}else{
			rPcs.push({type:p.type,row:r,col:c});
			if(p.type==='king')rKing={row:r,col:c};
		}
	}
	if(!rKing||!bKing)return null;
	var moves=aiGetAllMoves(board,'black');
	if(moves.length===0)return null;
	function scoreMoves(scoreFn){
		var best=null,bs=-Infinity;
		for(var i=0;i<moves.length;i++){var s=scoreFn(moves[i]);if(s>bs){bs=s;best=moves[i];}}
		return best;
	}
	if(bPcs.length<=2&&rPcs.length<=1&&bRook){
		return scoreMoves(function(m){
			if(m.piece.type==='king'){var d=Math.abs(m.toRow-rKing.row)+Math.abs(m.toCol-rKing.col);return 100-d*3;}
			if(m.piece.type==='rook'){
				var d=Math.abs(m.toRow-rKing.row)+Math.abs(m.toCol-rKing.col);
				var s=200-d*5;
				if(m.toRow===rKing.row||m.toCol===rKing.col)s+=30;
				if(m.toRow===0||m.toRow===9)s+=15;
				if(m.captured)s+=500;
				return s;
			}
			return -100;
		});
	}
	if(phase>=2&&bPawns.length>0){
		var bestPawn=null,bpScore=-Infinity;
		for(var i=0;i<bPawns.length;i++){
			var pw=bPawns[i],pr=pw.row;
			var adv=pr;
			if(adv>=5&&adv<9){
				for(var j=0;j<moves.length;j++){
					var m=moves[j];
					if(m.fromRow===pw.row&&m.fromCol===pw.col){
						var s=adv*10;
						if(m.toRow>m.fromRow)s+=20;
						if(m.toRow===9)s+=500;
						if(m.captured&&m.captured.type!=='king')s+=m.captured.type==='rook'?300:100;
						if(s>bpScore){bpScore=s;bestPawn=m;}
					}
				}
			}
		}
		if(bestPawn)return bestPawn;
	}
	if(phase>=2&&bPcs.length<=3&&rPcs.length<=3){
		var isEg = (phase>=2);
		var capWeight = isEg ? 1.0 : 1.5;
		var posWeight = isEg ? 1.0 : 0.6;
		var lossPenalty = isEg ? 50 : 30;
		function moveGivesCheck(mv){
			var cp=board[mv.toRow][mv.toCol];
			board[mv.toRow][mv.toCol]=mv.piece; board[mv.fromRow][mv.fromCol]=null;
			var inCheck=isKingInCheckFast(board,'red');
			board[mv.fromRow][mv.fromCol]=mv.piece; board[mv.toRow][mv.toCol]=cp;
			return inCheck;
		}
		function kingEscapeCount(){
			var esc=0;
			var ds=[[-1,0],[1,0],[0,-1],[0,1]];
			for(var d=0;d<ds.length;d++){
				var nr=rKing.row+ds[d][0], nc=rKing.col+ds[d][1];
				if(nr<0||nr>9||nc<0||nc>8)continue;
				if(nc<3||nc>5)continue;
				if(nr<7||nr>9)continue;
				var p=board[nr][nc];
				if(p&&p.color==='red')continue;
				var attacked=false;
				for(var rr=0;rr<10&&!attacked;rr++)for(var cc=0;cc<9&&!attacked;cc++){
					var bp=board[rr][cc];if(!bp||bp.color!=='black')continue;
					var ms=grmStandalone(board, rr,cc);
					for(var mi=0;mi<ms.length;mi++){if(ms[mi].row===nr&&ms[mi].col===nc){attacked=true;break;}}
				}
				if(!attacked)esc++;
			}
			return esc;
		}
		var escBefore=kingEscapeCount();
		return scoreMoves(function(m){
			var s=0;
			if(m.captured){
				if(m.captured.type==='king')s+=50000;
				else {
					s+=PV[m.captured.type]*capWeight;
					var loss=PV[m.piece.type]-PV[m.captured.type];
					if(loss>0)s-=loss*lossPenalty;
				}
			}
			if(moveGivesCheck(m))s+=400*posWeight;
			if(m.piece.type==='king'){
				var dr=Math.abs(m.toRow-rKing.row)+Math.abs(m.toCol-rKing.col);
				s-=dr*10*posWeight;
				if(m.toCol===rKing.col){
					var blocked=false;
					var minR=Math.min(m.toRow,rKing.row),maxR=Math.max(m.toRow,rKing.row);
					for(var rr=minR+1;rr<maxR;rr++){if(board[rr][m.toCol]){blocked=true;break;}}
					if(!blocked)s+=300*posWeight;
				}
			}
			if(m.piece.type==='rook'){
				var dr=Math.abs(m.toRow-rKing.row)+Math.abs(m.toCol-rKing.col);
				s+=(150-dr*8)*posWeight;
				if(m.toRow===rKing.row||m.toCol===rKing.col)s+=80*posWeight;
				if(m.toRow===rKing.row-1||m.toRow===rKing.row+1)s+=60*posWeight;
				if(m.toRow>=7)s+=30*posWeight;
			}
			if(m.piece.type==='cannon'){
				var dr=Math.abs(m.toRow-rKing.row)+Math.abs(m.toCol-rKing.col);
				s+=(80-dr*5)*posWeight;
				if(m.toRow===rKing.row||m.toCol===rKing.col)s+=60*posWeight;
			}
			if(m.piece.type==='horse'){
				var dr=Math.abs(m.toRow-rKing.row)+Math.abs(m.toCol-rKing.col);
				s+=(80-dr*8)*posWeight;
				var hd=Math.abs(m.toRow-rKing.row),hc=Math.abs(m.toCol-rKing.col);
				if((hd===2&&hc===1)||(hd===1&&hc===2))s+=200*posWeight;
			}
			if(m.piece.type==='pawn'){
				if(m.toRow>m.fromRow)s+=25*posWeight;
				if(m.toRow>=5)s+=m.toRow*6*posWeight;
				var pdr=Math.abs(m.toRow-rKing.row)+Math.abs(m.toCol-rKing.col);
				s+=Math.max(0,40-pdr*4)*posWeight;
				if(Math.abs(m.toRow-rKing.row)<=1&&Math.abs(m.toCol-rKing.col)<=1)s+=150*posWeight;
			}
			var cp=board[m.toRow][m.toCol];
			board[m.toRow][m.toCol]=m.piece; board[m.fromRow][m.fromCol]=null;
			var escAfter=kingEscapeCount();
			board[m.fromRow][m.fromCol]=m.piece; board[m.toRow][m.toCol]=cp;
			if(escAfter<escBefore)s+=(escBefore-escAfter)*50*posWeight;
			return s;
		});
	}
	return null;
}

// 8. Helper functions
function isInCheck(board,color){
	return isKingInCheckFast(board,color);
}

function isSquareAttackedFast(board,tr,tc,byColor){
	var dirs=[[-1,0],[1,0],[0,-1],[0,1]];
	for(var d=0;d<4;d++){
		var dr=dirs[d][0],dc=dirs[d][1],nr=tr+dr,nc=tc+dc,hasPiece=false;
		while(nr>=0&&nr<=9&&nc>=0&&nc<=8){
			var p=board[nr][nc];
			if(p){
				if(!hasPiece){if(p.color===byColor&&p.type==='rook')return true;hasPiece=true;}
				else{if(p.color===byColor&&p.type==='cannon')return true;break;}
			}
			nr+=dr;nc+=dc;
		}
	}
	var km=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
	var kl=[[-1,0],[-1,0],[0,-1],[0,1],[0,-1],[0,1],[1,0],[1,0]];
	for(var i=0;i<8;i++){
		var hr=tr+km[i][0],hc=tc+km[i][1];
		if(hr<0||hr>9||hc<0||hc>8)continue;
		var p=board[hr][hc];
		if(p&&p.color===byColor&&p.type==='horse'){
			var lr=tr+kl[i][0],lc=tc+kl[i][1];
			if(lr>=0&&lr<=9&&lc>=0&&lc<=8&&!board[lr][lc])return true;
		}
	}
	if(byColor==='red'){
		if(tr+1<=9){var p=board[tr+1][tc];if(p&&p.color==='red'&&p.type==='pawn')return true;}
		if(tr<=4){
			if(tc-1>=0){var p=board[tr][tc-1];if(p&&p.color==='red'&&p.type==='pawn')return true;}
			if(tc+1<=8){var p=board[tr][tc+1];if(p&&p.color==='red'&&p.type==='pawn')return true;}
		}
	}else{
		if(tr-1>=0){var p=board[tr-1][tc];if(p&&p.color==='black'&&p.type==='pawn')return true;}
		if(tr>=5){
			if(tc-1>=0){var p=board[tr][tc-1];if(p&&p.color==='black'&&p.type==='pawn')return true;}
			if(tc+1<=8){var p=board[tr][tc+1];if(p&&p.color==='black'&&p.type==='pawn')return true;}
		}
	}
	var kd=[[-1,0],[1,0],[0,-1],[0,1]];
	for(var i=0;i<4;i++){
		var nr=tr+kd[i][0],nc=tc+kd[i][1];
		if(nr<0||nr>9||nc<0||nc>8)continue;
		var p=board[nr][nc];
		if(p&&p.color===byColor&&p.type==='king')return true;
	}
	return false;
}
//========================================================
function simpleSEE(board,move,color){
var toRow=move.toRow,toCol=move.toCol;
var piece=move.piece;
// ==========新增两行空判断，修复根源报错=========
if(!piece) return 0;
var gain = 0;
if(move.captured && move.captured.type){
    gain = PV[move.captured.type];
}
var oc=color==='black'?'red':'black';
// Apply move
var oldPiece=board[toRow][toCol];
board[toRow][toCol]=piece;
board[move.fromRow][move.fromCol]=null;
// Check if opponent can recapture
if(isSquareAttackedFast(board,toRow,toCol,oc)){
gain-=PV[piece.type];
// 3-ply: if losing, check if we can recapture (net: gain their piece, lose our recapturer)
	if(gain<0&&isSquareAttackedFast(board,toRow,toCol,color)){
	var oppMinVal=Infinity,ourMinVal=Infinity;
	for(var r=0;r<10;r++)for(var c=0;c<9;c++){
	var p=board[r][c];if(!p||p.color!==oc)continue;
	var ms=grmStandalone(board,r,c);
	for(var i=0;i<ms.length;i++){
	if(ms[i].row===toRow&&ms[i].col===toCol){
	if(PV[p.type]<oppMinVal)oppMinVal=PV[p.type];
	}
	}
	}
	for(var r=0;r<10;r++)for(var c=0;c<9;c++){
var p=board[r][c];if(!p||p.color!==color||(r===toRow&&c===toCol))continue;
var ms=grmStandalone(board,r,c);
for(var i=0;i<ms.length;i++){
if(ms[i].row===toRow&&ms[i].col===toCol){
if(PV[p.type]<ourMinVal)ourMinVal=PV[p.type];
}
}
}
if(oppMinVal<Infinity&&ourMinVal<Infinity){
gain+=Math.floor((oppMinVal-ourMinVal)*aiWeights.tradeAccuracy/100);
}
}
}
// Undo move
board[move.fromRow][move.fromCol]=piece;
board[toRow][toCol]=oldPiece;
return gain;
}
//===============================================================
function isKingInCheckFast(board,color){
	var kg=null;
	for(var r=0;r<10&&!kg;r++)for(var c=0;c<9&&!kg;c++){
		var p=board[r][c];if(p&&p.type==='king'&&p.color===color)kg={row:r,col:c};
	}
	if(!kg)return true;
	var oc=color==='red'?'black':'red';
	var km=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
	var kl=[[-1,0],[-1,0],[0,-1],[0,1],[0,-1],[0,1],[1,0],[1,0]];
	for(var i=0;i<8;i++){
		var nr=kg.row+km[i][0],nc=kg.col+km[i][1];
		if(nr<0||nr>9||nc<0||nc>8)continue;
		var p=board[nr][nc];
		if(p&&p.type==='horse'&&p.color===oc&&!board[kg.row+kl[i][0]][kg.col+kl[i][1]])return true;
	}
	var dirs=[[-1,0],[1,0],[0,-1],[0,1]];
	for(var d=0;d<4;d++){
		var dr=dirs[d][0],dc=dirs[d][1],nr=kg.row+dr,nc=kg.col+dc,hasPiece=false;
		while(nr>=0&&nr<=9&&nc>=0&&nc<=8){
			var p=board[nr][nc];
			if(p){
				if(!hasPiece){
					if(p.color===oc){
						if(p.type==='rook')return true;
						if(p.type==='king'&&(nr===kg.row+dr&&nc===kg.col+dc))return true;
					}
					hasPiece=true;
				}else{if(p.color===oc&&p.type==='cannon')return true;break;}
			}
			nr+=dr;nc+=dc;
		}
	}
	var diag=[[-1,-1],[-1,1],[1,-1],[1,1]];
	for(var i=0;i<4;i++){
		var nr=kg.row+diag[i][0],nc=kg.col+diag[i][1];
		if(nr<0||nr>9||nc<0||nc>8)continue;
		var p=board[nr][nc];if(!p||p.color!==oc)continue;
		if(p.type==='king')return true;
		if(p.type==='advisor'){
			if(oc==='red'){if(nr>=7&&nr<=9&&nc>=3&&nc<=5)return true;}
			else{if(nr>=0&&nr<=2&&nc>=3&&nc<=5)return true;}
		}
	}
	if(color==='red'){
		if(kg.row-1>=0){var p=board[kg.row-1][kg.col];if(p&&p.type==='pawn'&&p.color==='black')return true;}
		if(kg.row>=5){
			if(kg.col-1>=0){var p=board[kg.row][kg.col-1];if(p&&p.type==='pawn'&&p.color==='black')return true;}
			if(kg.col+1<=8){var p=board[kg.row][kg.col+1];if(p&&p.type==='pawn'&&p.color==='black')return true;}
		}
	}else{
		if(kg.row+1<=9){var p=board[kg.row+1][kg.col];if(p&&p.type==='pawn'&&p.color==='red')return true;}
		if(kg.row<=4){
			if(kg.col-1>=0){var p=board[kg.row][kg.col-1];if(p&&p.type==='pawn'&&p.color==='red')return true;}
			if(kg.col+1<=8){var p=board[kg.row][kg.col+1];if(p&&p.type==='pawn'&&p.color==='red')return true;}
		}
	}
	for(var r=0;r<10;r++)for(var c=0;c<9;c++){
		var p=board[r][c];
		if(p&&p.type==='king'&&p.color===oc&&c===kg.col){
			var blocked=false;
			for(var cr=Math.min(kg.row,r)+1;cr<Math.max(kg.row,r);cr++){if(board[cr][kg.col]){blocked=true;break;}}
			if(!blocked)return true;
			break;
		}
	}
	return false;
}

// 9. Evaluation function
function aiEval(board){
	var score=0,totalPcs=0,bKing=null,rKing=null,spB=0,spR=0;
	var blackRooks=0,blackHorses=0,blackCannons=0,redRooks=0,redHorses=0,redCannons=0;
	var blackMajorsVal=0,redMajorsVal=0;
	var redEleCount=0,redAdvCount=0;
	var blackCrossPawn=0,redCrossPawn=0;
	var rookColBlk={},rookColRed={};
	var pawnList=[];
	var blkRookOn7=false,redRookOn2=false;
	for(var r=0;r<10;r++)for(var c=0;c<9;c++){
		var p=board[r][c];if(!p)continue;totalPcs++;
		var v=PV[p.type]*10+getPST(p,r,c);
		if(p.color==='black'){
			score+=v;
			if(p.type==='king')bKing={row:r,col:c};
			if(p.type==='rook'){blackRooks++;blackMajorsVal+=1150;rookColBlk[c]=1;if(r===7)blkRookOn7=true;}
			if(p.type==='horse'){blackHorses++;blackMajorsVal+=430;if(r>=5)score+=60;}
			if(p.type==='cannon'){blackCannons++;blackMajorsVal+=530;}
			if(p.type==='pawn'){if(r>=5)blackCrossPawn++;pawnList.push({r:r,c:c,color:'black'});}
		}else{
			score-=v;
			if(p.type==='king')rKing={row:r,col:c};
			if(p.type==='rook'){redRooks++;redMajorsVal+=1150;rookColRed[c]=1;if(r===2)redRookOn2=true;}
			if(p.type==='horse'){redHorses++;redMajorsVal+=430;if(r<=4)score-=60;}
			if(p.type==='cannon'){redCannons++;redMajorsVal+=530;}
			if(p.type==='advisor')redAdvCount++;
			if(p.type==='elephant')redEleCount++;
			if(p.type==='pawn'){if(r<=4)redCrossPawn++;pawnList.push({r:r,c:c,color:'red'});}
		}
		if(r>=3&&r<=6&&c>=2&&c<=6){
			var cb=(r===4||r===5)&&(c===3||c===4||c===5)?8:4;
			if(p.type==='rook'||p.type==='cannon')cb*=2;
			if(p.color==='black')score+=cb;else score-=cb;
		}
		if(p.color==='black'&&r>=5){spB++;if(p.type==='rook'||p.type==='cannon')spB+=2;}
		if(p.color==='red'&&r<=4){spR++;if(p.type==='rook'||p.type==='cannon')spR+=2;}
	}
	var phase=totalPcs>=28?0:(totalPcs>=16?1:2);
	var ebBase=(16-totalPcs>0?16-totalPcs:0)*5;
	if(ebBase>0){
		for(var i=0;i<pawnList.length;i++){
			var pw=pawnList[i];var rr=pw.color==='red'?9-pw.r:pw.r;
			if(rr>=5){if(pw.color==='black')score+=ebBase;else score-=ebBase;}
		}
	}
	if(phase<=1&&bKing&&rKing){
		for(var cl=0;cl<2;cl++){
			var kg=cl===0?bKing:rKing,isBlack=cl===0;
			var danger=0,shield=0;
			var oc=isBlack?'red':'black';
			var kr0=Math.max(0,kg.row-2),kr1=Math.min(9,kg.row+2);
			var kc0=Math.max(0,kg.col-2),kc1=Math.min(8,kg.col+2);
			for(var kr=kr0;kr<=kr1;kr++)for(var kc=kc0;kc<=kc1;kc++){
				var np=board[kr][kc];
				if(np&&np.color===oc){
					if(np.type==='rook'||np.type==='cannon')danger+=15;
					else if(np.type==='horse')danger+=10;
					else if(np.type==='pawn')danger+=5;
				}
			}
			var frontRow=isBlack?kg.row+1:kg.row-1;
			if(frontRow>=0&&frontRow<=9){
				for(var pc=Math.max(0,kg.col-1);pc<=Math.min(8,kg.col+1);pc++){
					var sp=board[frontRow][pc];
					if(sp&&sp.color===(isBlack?'black':'red')){
						if(sp.type==='pawn')shield+=20;
						else if(sp.type==='elephant')shield+=10;
					}
				}
			}
			if(isBlack){score-=danger*3;score+=shield;}
			else{score+=danger*3;score-=shield;}
		}
	}
	if(phase>=2&&bKing&&rKing){
		score+=bKing.row*5;score-=(9-rKing.row)*5;
		var kd=Math.abs(bKing.row-rKing.row)+Math.abs(bKing.col-rKing.col);
		score+=Math.max(0,20-kd)*2;
	}
	for(var c=0;c<9;c++){
		var hasBlk=!!rookColBlk[c],hasRed=!!rookColRed[c];
		if(hasBlk&&!hasRed)score+=12;
		if(hasRed&&!hasBlk)score-=12;
		if(c===1||c===3||c===4||c===7){
			if(hasBlk)score+=60;
			if(hasRed)score-=60;
		}
	}
	if(blkRookOn7)score+=15;
	if(redRookOn2)score-=15;
	if(blackHorses>0&&blackCannons>0)score+=100;
	if(redHorses>0&&redCannons>0)score-=100;
	var majorDiff=redMajorsVal-blackMajorsVal;
	if(majorDiff>0)score-=majorDiff*5;
	var rookDiff=redRooks-blackRooks;
	if(rookDiff>0)score-=rookDiff*1500;
	var horseDiff=redHorses-blackHorses;
	if(horseDiff>0)score-=horseDiff*800;
	var cannonDiff=redCannons-blackCannons;
	if(cannonDiff>0)score-=cannonDiff*800;
	score+=blackCrossPawn*40;score-=redCrossPawn*40;
	if(redEleCount===0&&redAdvCount===0)score+=blackCannons*180;
	else if(redEleCount+redAdvCount>=3)score-=blackCannons*100;
	var mobB=0,mobR=0;
	var dirs4=[[-1,0],[1,0],[0,-1],[0,1]];
	var hm8=[[-2,-1,-1,0],[-2,1,-1,0],[2,-1,1,0],[2,1,1,0],[-1,-2,0,-1],[-1,2,0,1],[1,-2,0,-1],[1,2,0,1]];
	for(var r=0;r<10;r++)for(var c=0;c<9;c++){
		var p=board[r][c];if(!p)continue;
		var isBlk=p.color==='black';
		if(p.type==='rook'){
			for(var d=0;d<4;d++){
				var nr=r+dirs4[d][0],nc=c+dirs4[d][1];
				while(nr>=0&&nr<=9&&nc>=0&&nc<=8){
					if(isBlk)mobB++;else mobR++;
					if(board[nr][nc])break;
					nr+=dirs4[d][0];nc+=dirs4[d][1];
				}
			}
		}else if(p.type==='cannon'){
			for(var d=0;d<4;d++){
				var nr=r+dirs4[d][0],nc=c+dirs4[d][1];
				while(nr>=0&&nr<=9&&nc>=0&&nc<=8){
					if(!board[nr][nc]){if(isBlk)mobB++;else mobR++;nr+=dirs4[d][0];nc+=dirs4[d][1];}
					else break;
				}
			}
		}else if(p.type==='horse'){
			for(var i=0;i<8;i++){
				var nr=r+hm8[i][0],nc=c+hm8[i][1];
				if(nr<0||nr>9||nc<0||nc>8)continue;
				if(board[r+hm8[i][2]][c+hm8[i][3]])continue;
				if(isBlk)mobB++;else mobR++;
			}
		}
	}
	score+=(mobB-mobR)*3;
	score+=spB*aiWeights.mobility;score-=spR*aiWeights.mobility;
	if(phase===0){
		for(var r=0;r<10;r++)for(var c=0;c<9;c++){
			var dp=board[r][c];if(!dp)continue;
			if(dp.color==='black'){
				if(dp.type==='horse'&&!(r===0&&(c===1||c===7)))score+=aiWeights.horseDeveloped;
				if(dp.type==='cannon'){if(r===2&&(c===1||c===7))score+=aiWeights.cannonDeveloped*2;else score-=aiWeights.cannonDeveloped;}
				if(dp.type==='rook'){
					if(r===0&&(c===0||c===8))score-=aiWeights.rookNotMoved;
					else if(r>=5)score+=aiWeights.rookCrossed;
					else score+=aiWeights.rookDeveloped;
				}
				if(dp.type==='advisor'&&!(r===0&&(c===3||c===5)))score-=aiWeights.rookNotMoved*2;
				if(dp.type==='king'&&!(r===0&&c===4))score-=aiWeights.rookNotMoved*3;
			}
			else{
				if(dp.type==='horse'&&!(r===9&&(c===1||c===7)))score-=aiWeights.horseDeveloped;
				if(dp.type==='cannon'){if(r===7&&(c===1||c===7))score-=aiWeights.cannonDeveloped*2;else score+=aiWeights.cannonDeveloped;}
				if(dp.type==='rook'){
					if(r===9&&(c===0||c===8))score+=aiWeights.rookNotMoved;
					else if(r<=4)score-=aiWeights.rookCrossed;
					else score-=aiWeights.rookDeveloped;
				}
				if(dp.type==='advisor'&&!(r===9&&(c===3||c===5)))score+=aiWeights.rookNotMoved*2;
				if(dp.type==='king'&&!(r===9&&c===4))score+=aiWeights.rookNotMoved*3;
			}
		}
	}
	if(phase>=2){
		var bK=null,rK=null;
		for(var r=0;r<10&&(!bK||!rK);r++)for(var c=0;c<9&&(!bK||!rK);c++){
			var kp=board[r][c];
			if(!kp)continue;
			if(kp.type==='king'&&kp.color==='black')bK={r:r,c:c};
			if(kp.type==='king'&&kp.color==='red')rK={r:r,c:c};
		}
		if(bK&&rK){
			var bKDist=Math.abs(bK.r-rK.r)+Math.abs(bK.c-rK.c);
			score+=(10-bKDist)*aiWeights.approach;
			if(bK.c>=3&&bK.c<=5)score+=aiWeights.centerControl;
			if(bK.c===rK.c){
				var blk=false;
				var mnR=Math.min(bK.r,rK.r),mxR=Math.max(bK.r,rK.r);
				for(var rr=mnR+1;rr<mxR;rr++){if(board[rr][bK.c]){blk=true;break;}}
				if(!blk)score+=aiWeights.attackKing;
			}
			if(rK.c<2||rK.c>6)score+=aiWeights.limitKingMob;
			if(rK.r<2||rK.r>7)score+=aiWeights.limitKingMob;
			for(var r=0;r<10;r++)for(var c=0;c<9;c++){
				var pp=board[r][c];
				if(!pp)continue;
				if(pp.color==='black'&&pp.type==='pawn'){
					if(r>=5){
						var advance=r-4;
						score+=advance*advance*aiWeights.pawnPromotion/10;
						if(r===9)score+=aiWeights.pawnPromotion*3;
					}
				}
				if(pp.color==='red'&&pp.type==='pawn'){
					if(r<=4){
						var advance2=5-r;
						score-=advance2*advance2*aiWeights.pawnPromotion/10;
						if(r===0)score-=aiWeights.pawnPromotion*3;
					}
				}
				if(pp.color==='black'&&pp.type==='rook'){
					if(pp.r===rK.r||pp.c===rK.c)score+=aiWeights.attackKing;
					if(pp.r>=5)score+=aiWeights.rookCrossed/2;
					var rookMob=0;
					for(var dr=-1;dr<=1;dr++)for(var dc=-1;dc<=1;dc++){
						if(Math.abs(dr)+Math.abs(dc)!==1)continue;
						var nr=pp.r+dr,nc=pp.c+dc;
						while(nr>=0&&nr<10&&nc>=0&&nc<9){
							if(board[nr][nc])break;
							rookMob++;
							nr+=dr;nc+=dc;
						}
					}
					score+=rookMob*aiWeights.mobility;
				}
				if(pp.color==='red'&&pp.type==='rook'){
					if(pp.r===bK.r||pp.c===bK.c)score-=aiWeights.attackKing;
					if(pp.r<=4)score-=aiWeights.rookCrossed/2;
					var rRookMob=0;
					for(var dr=-1;dr<=1;dr++)for(var dc=-1;dc<=1;dc++){
						if(Math.abs(dr)+Math.abs(dc)!==1)continue;
						var nr=pp.r+dr,nc=pp.c+dc;
						while(nr>=0&&nr<10&&nc>=0&&nc<9){
							if(board[nr][nc])break;
							rRookMob++;
							nr+=dr;nc+=dc;
						}
					}
					score-=rRookMob*aiWeights.mobility;
				}
				if(pp.color==='black'&&pp.type==='cannon'){
					if(pp.r===rK.r||pp.c===rK.c)score+=aiWeights.checkBonus/6;
				}
				if(pp.color==='red'&&pp.type==='cannon'){
					if(pp.r===bK.r||pp.c===bK.c)score-=aiWeights.checkBonus/6;
				}
			}
		}
	}
	if(bKing&&rKing){
		var rAtkByBlk=0;
		var rkr0=Math.max(7,rKing.row-1),rkr1=Math.min(9,rKing.row+1);
		var rkc0=Math.max(3,rKing.col-1),rkc1=Math.min(5,rKing.col+1);
		for(var kr=rkr0;kr<=rkr1;kr++)for(var kc=rkc0;kc<=rkc1;kc++){
			if(isSquareAttackedFast(board,kr,kc,'black'))rAtkByBlk++;
		}
		var rKingMob=0;
		var rDirs=[[-1,0],[1,0],[0,-1],[0,1]];
		for(var d=0;d<4;d++){
			var nr=rKing.row+rDirs[d][0],nc=rKing.col+rDirs[d][1];
			if(nr>=7&&nr<=9&&nc>=3&&nc<=5){
				var t=board[nr][nc];
				if(!t||t.color==='black')rKingMob++;
			}
		}
		score+=rAtkByBlk*aiWeights.attackKing;
		score+=(4-rKingMob)*aiWeights.limitKingMob;
		score-=rAtkByBlk*aiWeights.kingSafety;
		var bAtkByRed=0;
		var bkr0=Math.max(0,bKing.row-1),bkr1=Math.min(2,bKing.row+1);
		var bkc0=Math.max(3,bKing.col-1),bkc1=Math.min(5,bKing.col+1);
		for(var kr=bkr0;kr<=bkr1;kr++)for(var kc=bkc0;kc<=bkc1;kc++){
			if(isSquareAttackedFast(board,kr,kc,'red'))bAtkByRed++;
		}
		var bKingMob=0;
		var bDirs=[[-1,0],[1,0],[0,-1],[0,1]];
		for(var d=0;d<4;d++){
			var nr=bKing.row+bDirs[d][0],nc=bKing.col+bDirs[d][1];
			if(nr>=0&&nr<=2&&nc>=3&&nc<=5){
				var t=board[nr][nc];
				if(!t||t.color==='red')bKingMob++;
			}
		}
		score-=bAtkByRed*aiWeights.attackKing;
		score-=(4-bKingMob)*aiWeights.limitKingMob;
		score+=bAtkByRed*aiWeights.kingSafety;
		for(var mr2=0;mr2<10;mr2++)for(var mc2=0;mc2<9;mc2++){
			var ap=board[mr2][mc2];if(!ap)continue;
			if(ap.color==='black'&&(ap.type==='rook'||ap.type==='cannon'||ap.type==='horse')){
				var dist=Math.abs(mr2-rKing.row)+Math.abs(mc2-rKing.col);
				if(dist<=3)score+=(4-dist)*aiWeights.approach;
			}
			if(ap.color==='red'&&(ap.type==='rook'||ap.type==='cannon'||ap.type==='horse')){
				var dist2=Math.abs(mr2-bKing.row)+Math.abs(mc2-bKing.col);
				if(dist2<=3)score-=(4-dist2)*aiWeights.approach;
			}
		}
	}
	score+=aiDetectFormationScore(board);
	score+=aiDetectPinnedAndHeartHorse(board);
	// 悬挂棋子检测：惩罚被攻击的棋子
	for(var r=0;r<10;r++)for(var c=0;c<9;c++){
		var p=board[r][c];if(!p)continue;
		if(p.type==='king')continue;
		var oppColor=p.color==='black'?'red':'black';
		if(isSquareAttackedFast(board,r,c,oppColor)){
			var penalty=PV[p.type]*aiWeights.hangingPenalty/100;
			if(p.color==='black')score-=penalty;
			else score+=penalty;
		}else{
			var bonus=PV[p.type]*aiWeights.pieceSafety/1000;
			if(p.color==='black')score+=bonus;
			else score-=bonus;
		}
	}
	var stage=aiGetGameStage(board);
	var rate=STAGE_RATE[stage];
	var blackMoves=0,redMoves=0;
	try{blackMoves=aiGetAllMoves(board,'black','black').length;redMoves=aiGetAllMoves(board,'red','red').length;}catch(e){}
	score+=(blackMoves-redMoves)*aiWeights.mobility*0.01*rate.mobility;
	var abs=score<0?-score:score;
	if(abs>2000)score+=score*0.03;
	return score;
}

// 10. Move sorting
function aiSortMoves(moves,depth,board,color){
	for(var i=0;i<moves.length;i++){
		var m=moves[i],sc=0;
		if(m.captured){sc=100000+PV[m.captured.type]*12-PV[m.piece.type]*2.5;
			var loss=PV[m.piece.type]-PV[m.captured.type];
			if(loss>0)sc-=loss*10;
			if(loss===0)sc-=3000;}
		else if(depth!==undefined&&aiKillers[depth]){
			var kl=aiKillers[depth];
			if((kl[0]&&m.fromRow===kl[0].fr&&m.fromCol===kl[0].fc&&m.toRow===kl[0].tr&&m.toCol===kl[0].tc)||(kl[1]&&m.fromRow===kl[1].fr&&m.fromCol===kl[1].fc&&m.toRow===kl[1].tr&&m.toCol===kl[1].tc))sc=90000;
			else sc=aiHistory[m.fromRow][m.fromCol][m.toRow][m.toCol];
		}else sc=aiHistory[m.fromRow][m.fromCol][m.toRow][m.toCol];
		if(!m.captured&&m.piece&&m.piece.type!=='king'){
			var isBlk=m.piece.color==='black';
			var crossed=(isBlk&&m.toRow>=5)||(!isBlk&&m.toRow<=4);
			var wasCrossed=(isBlk&&m.fromRow>=5)||(!isBlk&&m.fromRow<=4);
			if(crossed&&!wasCrossed){
				if(m.piece.type==='rook')sc+=8000;
				else if(m.piece.type==='horse')sc+=6000;
				else if(m.piece.type==='cannon')sc+=4000;
				else sc+=500;
			}
			if(crossed){
				if(m.piece.type==='rook')sc+=4000;
				else if(m.piece.type==='horse')sc+=3000;
				else if(m.piece.type==='cannon')sc+=2000;
			}
		}
		if(board&&color&&m.piece){
			var oppColor=color==='black'?'red':'black';
			if(m.piece.type!=='king'){
				var fromThreatened=isSquareAttackedFast(board,m.fromRow,m.fromCol,oppColor);
				var toSafe=!isSquareAttackedFast(board,m.toRow,m.toCol,oppColor);
				if(fromThreatened&&toSafe){sc+=50000+PV[m.piece.type]*10;}
				else if(fromThreatened){sc+=30000+PV[m.piece.type]*5;}
				if(!fromThreatened&&!toSafe&&!m.captured){sc-=5000;}
			}
			if(!m.captured){
				if(m.piece.type==='horse'){
					var isHorseHome=(color==='black'&&m.fromRow<=2&&(m.fromCol===1||m.fromCol===7))||(color==='red'&&m.fromRow>=7&&(m.fromCol===1||m.fromCol===7));
					if(isHorseHome)sc+=6000;
				}
				if(m.piece.type==='cannon'){
					var isCannonHome=(color==='black'&&m.fromRow===2&&(m.fromCol===1||m.fromCol===7))||(color==='red'&&m.fromRow>=7&&(m.fromCol===1||m.fromCol===7));
					if(isCannonHome)sc+=4000;
					var hasGoodPlatform=false;
					for(var dp=-1;dp<=1;dp+=2){
						if(board[m.fromRow+dp]&&board[m.fromRow+dp][m.fromCol]){hasGoodPlatform=true;break;}
						if(board[m.fromRow]&&board[m.fromRow][m.fromCol+dp]){hasGoodPlatform=true;break;}
					}
					if(hasGoodPlatform)sc+=1500;
				}
				if(m.piece.type==='rook'){
					var isRookHome=(color==='black'&&m.fromRow<=2&&(m.fromCol===0||m.fromCol===8))||(color==='red'&&m.fromRow>=7&&(m.fromCol===0||m.fromCol===8));
					var rookCrossed=(color==='black'&&m.toRow>=5)||(color==='red'&&m.toRow<=4);
					if(isRookHome){sc+=5000;if(rookCrossed)sc+=8000;}
				}
				if(!fromThreatened&&m.piece.type!=='king'){
					var isRetreat=(color==='black'&&m.toRow<m.fromRow)||(color==='red'&&m.toRow>m.fromRow);
					if(isRetreat)sc-=1000;
				}
			}
			var cp_saved=board[m.toRow][m.toCol];
			board[m.toRow][m.toCol]=m.piece;
			board[m.fromRow][m.fromCol]=null;
			if(isKingInCheckFast(board,oppColor)){
				sc+=50000;
				if(m.captured){
					var cv=PV[m.captured.type]||0,av=PV[m.piece.type]||0;
					if(cv>=av&&cv>=400)sc+=20000;
				}
			}
			board[m.fromRow][m.fromCol]=m.piece;
			board[m.toRow][m.toCol]=cp_saved;
		}
		m.sortScore=sc;
	}
	moves.sort(function(a,b){return b.sortScore-a.sortScore;});
}

// 11. Quiescence search
function aiQuiesce(board,alpha,beta,maximizing,qd){
        if(_timedOut)
            return aiEval(board);

        if(isTimeOver()){
            _timedOut=true;
            return aiEval(board);
        }	
        if(qd===undefined)qd=2;
	aiNodes++;
	// 搜索节点保护
        if(aiNodes > MAX_NODES){
            _timedOut=true;
            return aiEval(board);
        }

        if(_timedOut)return maximizing?alpha:beta;
	//if(aiStartTime&&Date.now()-aiStartTime>aiMaxTime){_timedOut=true;return maximizing?alpha:beta;}
	var color=maximizing?'black':'red';
	var inCheck=isKingInCheckFast(board,color);
	var st=aiEval(board);
	if(maximizing){if(st>=beta)return beta;if(st>alpha)alpha=st;}
	else{if(st<=alpha)return alpha;if(st<beta)beta=st;}
	if(!inCheck){
		if(maximizing&&st+20000<=alpha)return alpha;
		if(!maximizing&&st-20000>=beta)return beta;
	}
	if(!inCheck&&qd<=0)return st;
	if(inCheck&&qd<=1)return st;
	var moves=aiGetAllMoves(board,color);
	var qMoves;
	if(inCheck){
		qMoves=moves;
		if(qMoves.length>15){qMoves=qMoves.slice(0,15);}
	}else{
		qMoves=[];
		for(var i=0;i<moves.length;i++){
			if(moves[i].captured){
				qMoves.push(moves[i]);
			}
		}
		if(qMoves.length===0)return st;
	}
	aiSortMoves(qMoves,0,board,color);
	for(var i=0;i<qMoves.length;i++){
		if(aiStartTime&&Date.now()-aiStartTime>aiMaxTime)break;
		var m=qMoves[i],cp=aiApplyMove(board,m);
		if(aiStartTime&&Date.now()-aiStartTime>aiMaxTime){aiUndoMove(board,m,cp);return maximizing?alpha:beta;}
		var ev=aiQuiesce(board,alpha,beta,!maximizing,qd-1);
		aiUndoMove(board,m,cp);
		if(maximizing){if(ev>alpha)alpha=ev;if(alpha>=beta)return beta;}
		else{if(ev<beta)beta=ev;if(beta<=alpha)return alpha;}
	}
	return maximizing?alpha:beta;
}

// 12. Move generation
function aiGetAllMoves(board,color,turn){
	var allMoves=[];
	var moveCount=0;
	for(var r=0;r<10;r++)for(var c=0;c<9;c++){
		var p=board[r][c];if(!p||p.color!==color)continue;
		var ms=grmStandalone(board, r,c);
		for(var i=0;i<ms.length;i++){
			var m=ms[i];
			var cp=board[m.row][m.col];
			board[m.row][m.col]=p;board[r][c]=null;
			var inCheck=isKingInCheckFast(board,color);
			board[r][c]=p;board[m.row][m.col]=cp;
			if(!inCheck)allMoves.push({fromRow:r,fromCol:c,toRow:m.row,toCol:m.col,captured:cp,piece:{type:p.type,color:p.color}});
			moveCount++;
			// 新增：最多40步，防止兑子局面生成海量走法
	                //if(moveCount >= 40) return allMoves;
                        if(moveCount%20===0 && isTimeOver()){
	                    return allMoves;
                        }
		}
	}
	return allMoves;
}

// 13. Mate detection
function aiIsMateMove(board,move,color){
	if(isTimeOver()) return false;
	var oppColor=color==='black'?'red':'black';
	var cp=board[move.toRow][move.toCol];
	board[move.toRow][move.toCol]=move.piece;
	board[move.fromRow][move.fromCol]=null;
	var inCheck=isKingInCheckFast(board,oppColor);
	var hasEscape=false;
	if(inCheck){
		var oppMoves=aiGetAllMoves(board,oppColor);
		if(oppMoves&&oppMoves.length>0)hasEscape=true;
	}
	board[move.fromRow][move.fromCol]=move.piece;
	board[move.toRow][move.toCol]=cp;
	return inCheck&&!hasEscape;
}

// 14. Board operations
function aiApplyMove(board,move){
	var cp=board[move.toRow][move.toCol];
	board[move.toRow][move.toCol]=board[move.fromRow][move.fromCol];
	board[move.fromRow][move.fromCol]=null;
	return cp;
}

function aiUndoMove(board,move,captured){
	board[move.fromRow][move.fromCol]=move.piece;
	board[move.toRow][move.toCol]=captured;
}

// 15. Search function
function aiSearch(board,depth,alpha,beta,maximizing,ply,extCount){
        if(_timedOut)
            return aiEval(board);

        if(isTimeOver()){
            _timedOut=true;
            return aiEval(board);
        }	
        aiNodes++;
	// 搜索节点限制，防止连续将军/吃子卡死
        if(aiNodes > MAX_NODES){
            _timedOut=true;
            return aiEval(board);
        }

        if(extCount===undefined)extCount=0;
	//if(aiStartTime&&Date.now()-aiStartTime>aiMaxTime){_timedOut=true;return maximizing?alpha:beta;}
	if(ply>60)return aiEval(board);
	if(extCount>2)extCount=2;
	var key=boardKey(board,maximizing?'black':'red');
	var entry=aiTT[key];
	if(entry&&entry.depth>=depth){
		if(entry.flag===TT_EXACT)return entry.score;
		if(entry.flag===TT_ALPHA&&entry.score<=alpha)return alpha;
		if(entry.flag===TT_BETA&&entry.score>=beta)return beta;
	}
	var color=maximizing?'black':'red';
	if(depth<=0)return aiQuiesce(board,alpha,beta,maximizing);
	var moves=aiGetAllMoves(board,color);
	if(moves.length===0)return maximizing?-99999+ply:99999-ply;
	var inCheck=isKingInCheckFast(board,color);
	if(!inCheck&&depth<=2){
		var st=aiEval(board);
		var razorMargin=depth===1?20000:35000;
		if(maximizing){
			if(st+razorMargin<=alpha)return alpha;
			if(st-depth*8000>=beta)return beta;
		}
		else{
			if(st-razorMargin>=beta)return beta;
			if(st+depth*8000<=alpha)return alpha;
		}
	}
	if(depth>=3&&ply>0&&!inCheck){
		var hasMat=false;
		for(var r=0;r<10&&!hasMat;r++)for(var c=0;c<9&&!hasMat;c++){var p=board[r][c];if(p&&p.color===color&&p.type!=='king'&&p.type!=='pawn')hasMat=true;}
		if(hasMat){
			var R=2;
			var nmScore=aiSearch(board,depth-R,alpha,beta,!maximizing,ply+1,extCount);
			if(maximizing&&nmScore>=beta)return beta;
			if(!maximizing&&nmScore<=alpha)return alpha;
		}
	}
	var hashMove=entry?entry.move:null;
	if(!hashMove&&depth>=4){
		aiSearch(board,depth-2,alpha,beta,maximizing,ply,extCount);
		entry=aiTT[key];
		hashMove=entry?entry.move:null;
	}
	aiSortMoves(moves,depth,board,color);
	var bestMove=null,origAlpha=alpha,nodeEval=null;
	if(maximizing){
		var bestScore=-Infinity;
		for(var i=0;i<moves.length;i++){
			if(_timedOut||(aiStartTime&&Date.now()-aiStartTime>aiMaxTime))break;
			var m=moves[i];
			if(depth<=2&&!m.captured&&m.piece&&m.piece.type!=='king'&&!inCheck){if(nodeEval===null)nodeEval=aiEval(board);if(nodeEval+5000<=alpha)continue;}
			var cp=aiApplyMove(board,m);
			var givesCheck=isKingInCheckFast(board,'red');
			var score;
			var ext=givesCheck&&extCount<2?1:0;
			var newExtCount=extCount+(givesCheck?1:0);
			if(i===0){score=aiSearch(board,depth-1+ext,alpha,beta,false,ply+1,newExtCount);}
			else{
				var R=0;
				if(i>=4&&depth>=3&&!m.captured&&!givesCheck){R=1;if(i>=10&&depth>=5)R=2;}
				score=aiSearch(board,depth-1+ext-R,alpha,alpha+1,false,ply+1,newExtCount);
				if(R>0&&score>alpha)score=aiSearch(board,depth-1+ext,alpha,alpha+1,false,ply+1,newExtCount);
				if(score>alpha&&score<beta)score=aiSearch(board,depth-1+ext,alpha,beta,false,ply+1,newExtCount);
			}
			aiUndoMove(board,m,cp);
			if(score>bestScore){bestScore=score;bestMove=m;}
			if(score>alpha)alpha=score;
			if(alpha>=beta){
				if(!aiKillers[depth])aiKillers[depth]=[];
				aiKillers[depth][1]=aiKillers[depth][0];
				aiKillers[depth][0]={fr:m.fromRow,fc:m.fromCol,tr:m.toRow,tc:m.toCol};
				aiHistory[m.fromRow][m.fromCol][m.toRow][m.toCol]+=depth*depth;
				break;
			}
		}
		var flag=bestScore<=origAlpha?TT_ALPHA:(bestScore>=beta?TT_BETA:TT_EXACT);
		aiTT[key]={depth:depth,score:bestScore,flag:flag,move:bestMove};
		return bestScore;
	}else{
		var bestScore=Infinity,origBeta=beta;
		for(var i=0;i<moves.length;i++){
			if(_timedOut||(aiStartTime&&Date.now()-aiStartTime>aiMaxTime))break;
			var m=moves[i];
			if(depth<=2&&!m.captured&&m.piece&&m.piece.type!=='king'&&!inCheck){if(nodeEval===null)nodeEval=aiEval(board);if(nodeEval-5000>=beta)continue;}
			var cp=aiApplyMove(board,m);
			var givesCheck=isKingInCheckFast(board,'black');
			var score;
			var ext=givesCheck&&extCount<2?1:0;
			var newExtCount=extCount+(givesCheck?1:0);
			if(i===0){score=aiSearch(board,depth-1+ext,alpha,beta,true,ply+1,newExtCount);}
			else{
				var R=0;
				if(i>=4&&depth>=3&&!m.captured&&!givesCheck){R=1;if(i>=10&&depth>=5)R=2;}
				score=aiSearch(board,depth-1+ext-R,beta-1,beta,true,ply+1,newExtCount);
				if(R>0&&score<beta)score=aiSearch(board,depth-1+ext,beta-1,beta,true,ply+1,newExtCount);
				if(score<beta&&score>alpha)score=aiSearch(board,depth-1+ext,alpha,beta,true,ply+1,newExtCount);
			}
			aiUndoMove(board,m,cp);
			if(score<bestScore){bestScore=score;bestMove=m;}
			if(score<beta)beta=score;
			if(beta<=alpha){
				if(!aiKillers[depth])aiKillers[depth]=[];
				aiKillers[depth][1]=aiKillers[depth][0];
				aiKillers[depth][0]={fr:m.fromRow,fc:m.fromCol,tr:m.toRow,tc:m.toCol};
				aiHistory[m.fromRow][m.fromCol][m.toRow][m.toCol]+=depth*depth;
				break;
			}
		}
		var flag=bestScore<=alpha?TT_ALPHA:(bestScore>=origBeta?TT_BETA:TT_EXACT);
		aiTT[key]={depth:depth,score:bestScore,flag:flag,move:bestMove};
		return bestScore;
	}
}

// 16. Find best move
function aiFindBestMove(board,color,moveHistory,depth){
	var aiCl=color||'black';
	var boardRef=board;
	var aiMax=(aiCl==='black');
	var hasAttackedPiece=isKingInCheckFast(boardRef,aiCl);
	if(!hasAttackedPiece){
		var bm=lookupOpeningBook(boardRef, moveHistory||[], aiCl);
		if(bm){
			if(bm.captured&&bm.piece&&bm.piece.type!=='king'&&bm.piece.type!=='pawn'){
				var seeBoard=[];
				for(var r=0;r<10;r++){seeBoard[r]=[];for(var c=0;c<9;c++)seeBoard[r][c]=boardRef[r][c];}
				bm.piece=seeBoard[bm.fromRow][bm.fromCol];
				var seeScore=simpleSEE(seeBoard,bm,aiCl);
				if(bm.piece&&seeScore<0){bm=null;}
			}
		}
		if(bm){
			if(!bm.piece)bm.piece=boardRef[bm.fromRow][bm.fromCol];
			console.log('=== lookupOpeningBook: returning move ===');
			console.log('aiCl:', aiCl);
			console.log('book move:', JSON.stringify({fromRow: bm.fromRow, fromCol: bm.fromCol, toRow: bm.toRow, toCol: bm.toCol, piece: bm.piece ? bm.piece.color + '-' + bm.piece.type : 'null'}));
			return bm;
		}
		var mg=lookupMgEgLib(boardRef, aiCl);
		if(mg){
			if(mg.piece&&mg.piece.type!=='king'&&mg.piece.type!=='pawn'){
				var seeBoard2=[];
				for(var r=0;r<10;r++){seeBoard2[r]=[];for(var c=0;c<9;c++)seeBoard2[r][c]=boardRef[r][c];}
				mg.piece=seeBoard2[mg.fromRow][mg.fromCol];
				if(mg.piece&&simpleSEE(seeBoard2,mg,aiCl)<0){mg=null;}
			}
		}
		if(mg){if(!mg.piece)mg.piece=boardRef[mg.fromRow][mg.fromCol];if(isMoveLegal(boardRef,mg.fromRow,mg.fromCol,mg.toRow,mg.toCol,aiCl)){return mg;}}
	}
	var boardCopy=[];
	for(var r=0;r<10;r++){boardCopy[r]=[];for(var c=0;c<9;c++)boardCopy[r][c]=boardRef[r][c];}
	var allMoves=aiGetAllMoves(boardCopy,aiCl);
	if(allMoves.length===0)return null;
	for(var mi=0;mi<allMoves.length;mi++){
		var m=allMoves[mi];
		if(m.captured&&m.captured.type==='king')return m;
		if(aiIsMateMove(boardCopy,m,aiCl))return m;
	}
	aiNodes=0;aiStartTime=Date.now();_timedOut=false;aiTT={};aiKillers=[];
	aiSortMoves(allMoves, 0, boardCopy, aiCl);
	for(var si2=0;si2<allMoves.length;si2++){
		var m2=allMoves[si2];
		if(aiIsMateMove(boardCopy,m2,aiCl)){
			allMoves[si2].sortScore+=10000;
		}
	}
	allMoves.sort(function(a,b){return b.sortScore-a.sortScore;});
	var bestMove=allMoves[0],prevScore=0;
	var totalPieces = 0;
	for(var r=0;r<10;r++) for(var c=0;c<9;c++) if(boardCopy[r][c]) totalPieces++;
	var maxDepth = totalPieces >= 16 ? 11 : 12;
	var savedAiMaxTime = aiMaxTime;
	aiMaxTime = 8000;
	for(var depth=2;depth<=maxDepth;depth++){
		var currentBest=allMoves[0],currentBestScore=aiMax?-Infinity:Infinity;
		var alpha,beta,origAlpha,origBeta,delta=200;
		if(depth>=3&&(aiMax?prevScore>-90000:prevScore<90000)){origAlpha=alpha=prevScore-delta;origBeta=beta=prevScore+delta;}
		else{origAlpha=alpha=-Infinity;origBeta=beta=Infinity;}
		aiSortMoves(allMoves,depth,boardCopy,aiCl);
		var timedOut=false;
		for(var i=0;i<allMoves.length;i++){
			if(_timedOut){timedOut=true;break;}
			var m=allMoves[i],cp=aiApplyMove(boardCopy,m);
			var score=aiSearch(boardCopy,depth-1,alpha,beta,!aiMax,1,0);
			aiUndoMove(boardCopy,m,cp);
			if(aiMax){
				if(score>currentBestScore){currentBestScore=score;currentBest=m;}
				if(score>alpha)alpha=score;
			}else{
				if(score<currentBestScore){currentBestScore=score;currentBest=m;}
				if(score<beta)beta=score;
			}
			if(Date.now()-aiStartTime>aiMaxTime){timedOut=true;break;}
		}
		if(!timedOut&&(currentBestScore<=origAlpha||currentBestScore>=origBeta)){
			alpha=-Infinity;beta=Infinity;
			aiSortMoves(allMoves,depth,boardCopy,aiCl);
			for(var i=0;i<allMoves.length;i++){
				if(_timedOut){timedOut=true;break;}
				var m=allMoves[i],cp=aiApplyMove(boardCopy,m);
				var score=aiSearch(boardCopy,depth-1,alpha,beta,!aiMax,1,0);
				aiUndoMove(boardCopy,m,cp);
				if(aiMax){
					if(score>currentBestScore){currentBestScore=score;currentBest=m;}
					if(score>alpha)alpha=score;
				}else{
					if(score<currentBestScore){currentBestScore=score;currentBest=m;}
					if(score<beta)beta=score;
				}
				if(Date.now()-aiStartTime>aiMaxTime){timedOut=true;break;}
			}
		}
		bestMove=currentBest;prevScore=currentBestScore;
		if(timedOut)break;
	}
	aiMaxTime = savedAiMaxTime;
	var inCheck=isKingInCheckFast(boardRef,aiCl);
	if(bestMove && bestMove.captured && bestMove.piece && bestMove.piece.type !== 'king' && bestMove.piece.type !== 'pawn'){
	var seeCheckBoard = [];
	for(var sr=0;sr<10;sr++){seeCheckBoard[sr]=[];for(var sc=0;sc<9;sc++)seeCheckBoard[sr][sc]=boardRef[sr][sc];}
	bestMove.piece = seeCheckBoard[bestMove.fromRow][bestMove.fromCol];
	if(bestMove.piece && simpleSEE(seeCheckBoard, bestMove, aiCl) < 0){
		var fb = aiFindBestMoveNoBook(board,aiCl,moveHistory,depth);
		if(fb) return fb;
	        }
        }
	if(!inCheck&&bestMove&&!bestMove.captured&&bestMove.piece&&bestMove.piece.type!=='king'&&bestMove.piece.type!=='pawn'){
		var oppColor = aiCl === 'black' ? 'red' : 'black';
		var fromThreatened = isSquareAttackedFast(boardRef, bestMove.fromRow, bestMove.fromCol, oppColor);
		var safeBoard = [];
		for(var sr3=0;sr3<10;sr3++){safeBoard[sr3]=[];for(var sc3=0;sc3<9;sc3++)safeBoard[sr3][sc3]=boardRef[sr3][sc3];}
		safeBoard[bestMove.toRow][bestMove.toCol] = bestMove.piece;
		safeBoard[bestMove.fromRow][bestMove.fromCol] = null;
		var toSafe = !isSquareAttackedFast(safeBoard, bestMove.toRow, bestMove.toCol, oppColor);
		if(!toSafe && !fromThreatened){
			for(var si3=1; si3<allMoves.length; si3++){
				var alt2 = allMoves[si3];
				if(alt2.captured) continue;
				if(!alt2.piece) continue;
				if(alt2.piece.type === 'king' || alt2.piece.type === 'pawn'){bestMove = alt2; break;}
				var altSafeBoard = [];
				for(var ar3=0;ar3<10;ar3++){altSafeBoard[ar3]=[];for(var ac3=0;ac3<9;ac3++)altSafeBoard[ar3][ac3]=boardRef[ar3][ac3];}
				altSafeBoard[alt2.toRow][alt2.toCol] = altSafeBoard[alt2.fromRow][alt2.fromCol];
				altSafeBoard[alt2.fromRow][alt2.fromCol] = null;
				if(!isSquareAttackedFast(altSafeBoard, alt2.toRow, alt2.toCol, oppColor)){bestMove = alt2; break;}
			}
		}
	}
	return bestMove;
}

// 17. Find best move (no book)
function aiFindBestMoveNoBook(board,color,moveHistory,depth){
	var aiCl=color||'black';
	var boardRef=board;
	var aiMax=(aiCl==='black');
	var boardCopy=[];
	for(var r=0;r<10;r++){boardCopy[r]=[];for(var c=0;c<9;c++)boardCopy[r][c]=boardRef[r][c];}
	var allMoves=aiGetAllMoves(boardCopy,aiCl);
	if(allMoves.length===0)return null;
	for(var mi=0;mi<allMoves.length;mi++){
		var m=allMoves[mi];
		if(m.captured&&m.captured.type==='king')return m;
		if(aiIsMateMove(boardCopy,m,aiCl))return m;
	}
	aiNodes=0;aiStartTime=Date.now();_timedOut=false;aiTT={};aiKillers=[];
	aiSortMoves(allMoves, 0, boardCopy, aiCl);
	allMoves.sort(function(a,b){return b.sortScore-a.sortScore;});
	var bestMove=allMoves[0],prevScore=0;
	var totalPieces = 0;
	for(var r=0;r<10;r++) for(var c=0;c<9;c++) if(boardCopy[r][c]) totalPieces++;
	var maxDepth = totalPieces >= 16 ? 11 : 12;
	for(var depth=2;depth<=maxDepth;depth++){
		var currentBest=allMoves[0],currentBestScore=aiMax?-Infinity:Infinity;
		var alpha,beta,origAlpha,origBeta,delta=200;
		if(depth>=3&&(aiMax?prevScore>-90000:prevScore<90000)){origAlpha=alpha=prevScore-delta;origBeta=beta=prevScore+delta;}
		else{origAlpha=alpha=-Infinity;origBeta=beta=Infinity;}
		aiSortMoves(allMoves,depth,boardCopy,aiCl);
		var timedOut=false;
		for(var i=0;i<allMoves.length;i++){
			if(_timedOut){timedOut=true;break;}
			var m=allMoves[i],cp=aiApplyMove(boardCopy,m);
			var score=aiSearch(boardCopy,depth-1,alpha,beta,!aiMax,1,0);
			aiUndoMove(boardCopy,m,cp);
			if(aiMax){
				if(score>currentBestScore){currentBestScore=score;currentBest=m;}
				if(score>alpha)alpha=score;
			}else{
				if(score<currentBestScore){currentBestScore=score;currentBest=m;}
				if(score<beta)beta=score;
			}
			if(Date.now()-aiStartTime>aiMaxTime){timedOut=true;break;}
		}
		if(!timedOut&&(currentBestScore<=origAlpha||currentBestScore>=origBeta)){
			alpha=-Infinity;beta=Infinity;
			aiSortMoves(allMoves,depth,boardCopy,aiCl);
			for(var i=0;i<allMoves.length;i++){
				var m=allMoves[i],cp=aiApplyMove(boardCopy,m);
				var score=aiSearch(boardCopy,depth-1,alpha,beta,!aiMax,1,0);
				aiUndoMove(boardCopy,m,cp);
				if(aiMax){
					if(score>currentBestScore){currentBestScore=score;currentBest=m;}
					if(score>alpha)alpha=score;
				}else{
					if(score<currentBestScore){currentBestScore=score;currentBest=m;}
					if(score<beta)beta=score;
				}
				if(Date.now()-aiStartTime>aiMaxTime){timedOut=true;break;}
			}
		}
		bestMove=currentBest;prevScore=currentBestScore;
		if(timedOut)break;
	}
	if(bestMove && bestMove.captured && bestMove.piece && bestMove.piece.type !== 'king' && bestMove.piece.type !== 'pawn'){
		var seeCheckBoard2 = [];
		for(var sr2=0;sr2<10;sr2++){seeCheckBoard2[sr2]=[];for(var sc2=0;sc2<9;sc2++)seeCheckBoard2[sr2][sc2]=boardRef[sr2][sc2];}
		bestMove.piece = seeCheckBoard2[bestMove.fromRow][bestMove.fromCol];
		if(simpleSEE(seeCheckBoard2, bestMove, aiCl) < 0){
			for(var si=1; si<allMoves.length; si++){
				var alt = allMoves[si];
				if(!alt.piece) continue;
				if(!alt.captured || alt.piece.type === 'king' || alt.piece.type === 'pawn'){bestMove = alt; break;}
				var altBoard = [];
				for(var ar=0;ar<10;ar++){altBoard[ar]=[];for(var ac=0;ac<9;ac++)altBoard[ar][ac]=boardRef[ar][ac];}
				alt.piece = altBoard[alt.fromRow][alt.fromCol];
				if(simpleSEE(altBoard, alt, aiCl) >= 0){bestMove = alt; break;}
			}
		}
	}
	var inCheck2=isKingInCheckFast(boardRef,aiCl);
	if(!inCheck2&&bestMove&&!bestMove.captured&&bestMove.piece&&bestMove.piece.type!=='king'&&bestMove.piece.type!=='pawn'){
		var oppColor2 = aiCl === 'black' ? 'red' : 'black';
		var fromThreatened2 = isSquareAttackedFast(boardRef, bestMove.fromRow, bestMove.fromCol, oppColor2);
		var safeBoard2 = [];
		for(var sr4=0;sr4<10;sr4++){safeBoard2[sr4]=[];for(var sc4=0;sc4<9;sc4++)safeBoard2[sr4][sc4]=boardRef[sr4][sc4];}
		safeBoard2[bestMove.toRow][bestMove.toCol] = bestMove.piece;
		safeBoard2[bestMove.fromRow][bestMove.fromCol] = null;
		var toSafe2 = !isSquareAttackedFast(safeBoard2, bestMove.toRow, bestMove.toCol, oppColor2);
		if(!toSafe2 && !fromThreatened2){
			for(var si4=1; si4<allMoves.length; si4++){
				var alt3 = allMoves[si4];
				if(alt3.captured) continue;
				if(!alt3.piece) continue;
				if(alt3.piece.type === 'king' || alt3.piece.type === 'pawn'){bestMove = alt3; break;}
				var altSafeBoard2 = [];
				for(var ar4=0;ar4<10;ar4++){altSafeBoard2[ar4]=[];for(var ac4=0;ac4<9;ac4++)altSafeBoard2[ar4][ac4]=boardRef[ar4][ac4];}
				altSafeBoard2[alt3.toRow][alt3.toCol] = altSafeBoard2[alt3.fromRow][alt3.fromCol];
				altSafeBoard2[alt3.fromRow][alt3.fromCol] = null;
				if(!isSquareAttackedFast(altSafeBoard2, alt3.toRow, alt3.toCol, oppColor2)){bestMove = alt3; break;}
			}
		}
	}
	if(bestMove){
		var movePiece = boardRef[bestMove.fromRow][bestMove.fromCol];
		if(movePiece && movePiece.color !== aiCl){
			console.error('ERROR: aiFindBestMove returning wrong color! aiCl:', aiCl, 'piece color:', movePiece.color);
			for(var vi=0; vi<allMoves.length; vi++){
				var vm = allMoves[vi];
				var vp = boardRef[vm.fromRow][vm.fromCol];
				if(vp && vp.color === aiCl){
					bestMove = vm;
					break;
				}
			}
		}
	}
	return bestMove;
}

// 18. Worker message handler
self.onmessage = function(e) {
	var data = e.data;
	var board = data.board;
	var aiCl = data.aiCl || 'black';
	var moveHistory = data.moveHistory || [];
	var maxTime = data.aiMaxTime || 900;
	
	if(data.aiWeights){
		console.log('=== Worker: received aiWeights ===');
		console.log('aiCl:', aiCl);
		console.log('received aiWeights:', JSON.stringify(data.aiWeights));
		for(var k in data.aiWeights){
			if(aiWeights[k] !== undefined) aiWeights[k] = data.aiWeights[k];
		}
		console.log('updated aiWeights:', JSON.stringify(aiWeights));
	}
	
	var boardCopy = [];
	for(var r=0; r<10; r++) {
		boardCopy[r] = [];
		for(var c=0; c<9; c++) {
			if(board[r][c]) {
				boardCopy[r][c] = {type: board[r][c].type, color: board[r][c].color};
			} else {
				boardCopy[r][c] = null;
			}
		}
	}
	// ==========【在这里插入重置代码】=========
        // 每次搜索初始化完整重置
        aiTT = Object.create(null); // 空原型，减少遍历
        aiKillers.length = 0;
        // 四维历史表不要只置0，按需局部重置，或者改用对象存储代替四维数组
        _timedOut = false;
	aiNodes = 0;
        // 历史表优化说明：原四维数组每次全置0性能差，这里不循环置0，按需覆盖
	// ========================================	

        aiStartTime = Date.now();
	aiMaxTime = Math.min(maxTime, 8000);
	_timedOut = false;
	aiTT = {};
	aiKillers = [];
        /*
	for(var r=0; r<10; r++) {
		for(var c=0; c<9; c++) {
			for(var tr=0; tr<10; tr++) {
				for(var tc=0; tc<9; tc++) {
					aiHistory[r][c][tr][tc] = 0;
				}
			}
		}
	}
	*/
	var move = aiFindBestMove(boardCopy, aiCl, moveHistory);
	
	console.log('=== Worker: returning move ===');
	console.log('aiCl:', aiCl);
	console.log('move:', move ? JSON.stringify({fromRow: move.fromRow, fromCol: move.fromCol, toRow: move.toRow, toCol: move.toCol, piece: move.piece ? move.piece.color + '-' + move.piece.type : 'null'}) : 'null');
	
	self.postMessage({ move: move });
};
