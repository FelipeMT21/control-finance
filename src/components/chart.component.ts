
import { Component, ElementRef, computed, effect, input, viewChild } from '@angular/core';
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
    <div #chartContainer class="w-full h-full flex items-center justify-center"></div>
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
      const el = this.chartContainer().nativeElement;
      
      if (!el) return;
      
      d3.select(el).selectAll('*').remove();
      
      // Check if we actually have positive values to show
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

      const width = el.clientWidth || 300;
      const height = el.clientHeight || 200;

      if (type === 'donut') {
        this.renderDonut(el, data, width, height);
      } else {
        this.renderBar(el, data, width, height);
      }
    });
  }

  private renderDonut(el: HTMLElement, data: ChartData[], width: number, height: number) {
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

    const paths = svg.selectAll('path')
      .data(pie(data))
      .enter()
      .append('path')
      .attr('d', arc)
      .attr('fill', d => d.data.color)
      .attr('stroke', 'currentColor')
      .attr('class', 'stroke-white dark:stroke-slate-800')
      .style('stroke-width', '2px')
      .style('opacity', 0.8);
      
    // Add center text
    const total = data.reduce((acc, d) => acc + d.value, 0);
    svg.append("text")
       .attr("text-anchor", "middle")
       .attr("dy", "-0.2em")
       .attr("class", "text-sm font-bold fill-gray-500 dark:fill-gray-400")
       .text("Total");
       
    svg.append("text")
       .attr("text-anchor", "middle")
       .attr("dy", "1.2em")
       .attr("class", "text-sm font-bold fill-gray-800 dark:fill-gray-100")
       .text(`R$ ${Math.round(total)}`);
  }

  private renderBar(el: HTMLElement, data: ChartData[], width: number, height: number) {
    const margin = {top: 20, right: 20, bottom: 30, left: 50};
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    const svg = d3.select(el)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // X Axis
    const x = d3.scaleBand()
      .range([0, w])
      .domain(data.map(d => d.label))
      .padding(0.3);
    
    const xAxis = svg.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x));
    
    // Apply Tailwind classes to axis text
    xAxis.selectAll("text")
      .style("text-anchor", "middle")
      .attr("class", "fill-slate-500 dark:fill-slate-400 text-xs");
    
    xAxis.selectAll("path, line")
       .attr("class", "stroke-slate-200 dark:stroke-slate-600");

    // Y Axis
    const maxVal = d3.max(data, d => d.value) || 0;
    // Safety check: ensure domain max is at least 1 to avoid D3 scale collapse on [0,0]
    const y = d3.scaleLinear()
      .domain([0, maxVal || 1])
      .range([h, 0]);
    
    const yAxis = svg.append("g")
      .call(d3.axisLeft(y).ticks(5));

    yAxis.selectAll("text")
      .attr("class", "fill-slate-500 dark:fill-slate-400 text-xs");
      
    yAxis.selectAll("path, line")
       .attr("class", "stroke-slate-200 dark:stroke-slate-600");

    // Bars
    svg.selectAll("mybar")
      .data(data)
      .join("rect")
        .attr("x", d => x(d.label)!)
        .attr("y", d => y(d.value))
        .attr("width", x.bandwidth())
        .attr("height", d => h - y(d.value))
        .attr("fill", d => d.color)
        .attr("rx", 4);
  }
}
