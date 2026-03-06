require_relative 'rboost_rtree_2d_point'

rt = BOOST::R_tree_2d_point.new

puts (rt.methods - Object.methods).sort

=begin
[]
[]=
delete
each_object
each_pair
insert
intersects?
intersects_each?
intersects_rect?
intersects_rect_each?
nearest
nearest_each
nearest_rect
nearest_rect_each
rect
remove
to_a
update_or_insert
=end

rt.insert('p22', 2, 2)
p rt.point('p22') # query coorinates
rt.insert('p35', 3, 5)
rt.insert('p12', 1, 2)
rt.insert('p34', 1, 1) # wrong
rt.update_or_insert('p34', 2, 2) # still wrong
rt['r34'] = [3, 4] # correct

p rt['p35'] # [3, 5]

puts rt.intersects?(0.9, 0.9, 2.1, 2.1) # p12


puts rt.nearest_k(10, 10, 2) # should be p34 and p35

puts rt.nearest(10, 10) # should be p35

rt.remove('p35')
puts rt.nearest_k(10, 10, 2) # now should be p34

puts rt.nearest_k_point(10, 10, 2) # returns array -- object and x, y

puts rt.nearest_point(10, 10) # returns array -- object and x, y

rt.nearest_k_point_each(10, 10, 2){|r| print r[0], ' has coordinates ', r[1], r[2], "\n"}

rt.each_pair{|el| puts el}
rt.delete('p22')
rt.each_pair{|el| puts el}

a = rt.to_a
a.each{|el| p el}
