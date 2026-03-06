require_relative "rcgal_cdt"

t = CGAL::CDT.new

v1 = CGAL::Vertex.new(0, 0)
v2 = CGAL::Vertex.new(0, 10)
v3 = CGAL::Vertex.new(10, 0)
v4 = CGAL::Vertex.new(10, 10)

t.insert(v1)
t.insert(v2)
t.insert(v3)
t.insert(v4)

#t.insert_constraint(v1, v4)

t.each{|el| print el.x, ", ", el.y, "\n"}

t.each{|el|
  puts t.neighbor_vertices(el)
	puts
}

puts 'range search 5,1, 6'
t.range_search(5, 1, 6).each{|el| puts el.x, el.y}

puts (t.methods - Object.methods).sort
