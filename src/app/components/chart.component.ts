import { Component, ElementRef, input, viewChild, effect } from '@angular/core';
import * as d3 from 'd3';

export interface ChartData {
  label: string;
  value: number;
  color: string;
}

@Component({
  selector: 'app-chart',
  standalone: true,
  template: `
    <div #chartContainer class="relative w-full h-full flex items-center justify-center"></div>
  `
})
export class ChartComponent {
  data = input.required<ChartData[]>();
  type = input<'donut' | 'bar'>('donut');
  
  chartContainer = viewChild.required<ElementRef>('chartContainer');

  constructor() {
    effect(() => {
      const data = this.data();
      const type = this.type();
      const container = this.chartContainer();
      
      if (!container) return;
      const el = container.nativeElement;
      
      d3.select(el).selectAll('*').remove();
      
      const hasData = data.some(d => d.value > 0);

      if (data.length === 0 || !hasData) {
        d3.select(el)
          .append('div')
          .attr('class', 'flex flex-col items-center justify-center h-full w-full text-slate-400 dark:text-slate-500')
          .html(`
            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span class="text-xs font-medium">Sem dados para exibir</span>
          `);
        return;
      }

      const tooltip = d3.select(el)
        .append('div')
        .attr('class', 'absolute z-50 pointer-events-none opacity-0 transition-opacity duration-200 bg-slate-900/90 dark:bg-white/95 text-white dark:text-slate-900 px-3 py-2 rounded-lg shadow-xl text-xs backdrop-blur-sm')
        .style('top', '0')
        .style('left', '0');

      const width = el.clientWidth || 300;
      const height = el.clientHeight || 200;

      if (type === 'donut') {
        this.renderDonut(el, data, width, height, tooltip);
      } else {
        this.renderBar(el, data, width, height, tooltip);
      }
    });
  }

  private renderDonut(el: HTMLElement, data: ChartData[], width: number, height: number, tooltip: d3.Selection<HTMLDivElement, unknown, null, undefined>) {
    const radius = Math.min(width, height) / 2;
    const svg = d3.select(el)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    const pie = d3.pie<ChartData>()
      .value(d => d.value)
      .sort(null);

    const arc = d3.arc<d3.PieArcDatum<ChartData>>()
      .innerRadius(radius * 0.6)
      .outerRadius(radius - 10);

    const arcHover = d3.arc<d3.PieArcDatum<ChartData>>()
      .innerRadius(radius * 0.6)
      .outerRadius(radius - 5);

    const paths = svg.selectAll('path')
      .data(pie(data))
      .enter()
      .append('path')
      .attr('d', arc as any)
      .attr('fill', d => d.data.color)
      .attr('stroke', 'currentColor')
      .attr('class', 'stroke-white dark:stroke-slate-800 transition-all duration-300 cursor-pointer')
      .style('stroke-width', '2px')
      .style('opacity', 0.8);

    paths
      .on('mouseover', function(this: any, event: any, d: d3.PieArcDatum<ChartData>) {
        d3.select(this)
          .transition().duration(200)
          .style('opacity', 1)
          .attr('d', arcHover as any);
        
        tooltip.style('opacity', 1);
        tooltip.html(`
          <div class="font-bold mb-0.5">${d.data.label}</div>
          <div class="font-mono opacity-90">R$ ${d.data.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
        `);
      })
      .on('mousemove', function(event: MouseEvent) {
        const [x, y] = d3.pointer(event, el);
        tooltip
          .style('left', `${x + 15}px`)
          .style('top', `${y + 15}px`);
      })
      .on('mouseleave', function(this: any) {
        d3.select(this)
          .transition().duration(200)
          .style('opacity', 0.8)
          .attr('d', arc as any);
        
        tooltip.style('opacity', 0);
      });
      
    const total = data.reduce((acc, d) => acc + d.value, 0);
    svg.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "-0.2em")
        .attr("class", "text-sm font-bold fill-gray-500 dark:fill-gray-400 pointer-events-none")
        .text("Total");
        
    svg.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "1.2em")
        .attr("class", "text-sm font-bold fill-gray-800 dark:fill-gray-100 pointer-events-none")
        .text(`R$ ${Math.round(total)}`);
  }

  private renderBar(el: HTMLElement, data: ChartData[], width: number, height: number, tooltip: d3.Selection<HTMLDivElement, unknown, null, undefined>) {
    const margin = {top: 20, right: 20, bottom: 30, left: 50};
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    const svg = d3.select(el)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .range([0, w])
      .domain(data.map(d => d.label))
      .padding(0.3);
    
    const xAxis = svg.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x));
    
    xAxis.selectAll("text")
      .attr("class", "fill-slate-500 dark:fill-slate-400 text-xs");
    
    xAxis.selectAll("path, line")
       .attr("class", "stroke-slate-200 dark:stroke-slate-600");

    const maxVal = d3.max(data, d => d.value) || 0;
    const y = d3.scaleLinear()
      .domain([0, maxVal || 1])
      .range([h, 0]);
    
    const yAxis = svg.append("g")
      .call(d3.axisLeft(y).ticks(5));

    yAxis.selectAll("text")
      .attr("class", "fill-slate-500 dark:fill-slate-400 text-xs");
      
    yAxis.selectAll("path, line")
       .attr("class", "stroke-slate-200 dark:stroke-slate-600");

    svg.selectAll("rect")
      .data(data)
      .join("rect")
        .attr("x", d => x(d.label)!)
        .attr("y", d => y(d.value))
        .attr("width", x.bandwidth())
        .attr("height", d => h - y(d.value))
        .attr("fill", d => d.color)
        .attr("rx", 4)
        .attr("class", "transition-opacity duration-200 cursor-pointer")
        .style("opacity", 0.8)
        .on('mouseover', function(this: any, event: any, d: ChartData) {
          d3.select(this).style("opacity", 1);
          tooltip.style('opacity', 1);
          tooltip.html(`
            <div class="font-bold mb-0.5">${d.label}</div>
            <div class="font-mono opacity-90">R$ ${d.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
          `);
        })
        .on('mousemove', function(event: MouseEvent) {
          const [px, py] = d3.pointer(event, el);
          tooltip
            .style('left', `${px + 15}px`)
            .style('top', `${py + 15}px`);
        })
        .on('mouseleave', function(this: any) {
          d3.select(this).style("opacity", 0.8);
          tooltip.style('opacity', 0);
        });
  }
}