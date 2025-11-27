import { ChartJSNodeCanvas } from "chartjs-node-canvas"

const width = 1200
const height = 800
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height })

export async function generateActivityChart(dailyActivity, title) {
  const configuration = {
    type: "line",
    data: {
      labels: dailyActivity.map((d) => d.date),
      datasets: [
        {
          label: "Messages",
          data: dailyActivity.map((d) => d.count),
          borderColor: "rgb(99, 102, 241)",
          backgroundColor: "rgba(99, 102, 241, 0.1)",
          fill: true,
          tension: 0.4,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: title,
          font: { size: 24 },
        },
        legend: {
          display: true,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
        },
      },
    },
  }

  return await chartJSNodeCanvas.renderToBuffer(configuration)
}

export async function generateBarChart(data, labels, title) {
  const configuration = {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Count",
          data: data,
          backgroundColor: "rgba(99, 102, 241, 0.7)",
          borderColor: "rgb(99, 102, 241)",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: title,
          font: { size: 24 },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
        },
      },
    },
  }

  return await chartJSNodeCanvas.renderToBuffer(configuration)
}

export async function generateHeatmap(hourlyActivity) {
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const counts = hours.map((h) => {
    const found = hourlyActivity.find((a) => a.hour === h)
    return found ? found.count : 0
  })

  const configuration = {
    type: "bar",
    data: {
      labels: hours.map((h) => `${h}:00`),
      datasets: [
        {
          label: "Activity Level",
          data: counts,
          backgroundColor: counts.map((c) => {
            const max = Math.max(...counts)
            const intensity = c / max
            return `rgba(99, 102, 241, ${intensity})`
          }),
          borderColor: "rgb(99, 102, 241)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: "Activity Heatmap (24 Hours)",
          font: { size: 24 },
        },
        legend: {
          display: false,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Messages",
          },
        },
        x: {
          title: {
            display: true,
            text: "Hour of Day",
          },
        },
      },
    },
  }

  return await chartJSNodeCanvas.renderToBuffer(configuration)
}
