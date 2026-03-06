require_relative 'rboost_rtree_2d_rect'

rt = BOOST::R_tree_2d_rect.new

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

rt.insert('r2277', 2, 2, 7, 7)
p rt.rect('r2277') # query coorinates
rt.insert('r3589', 3, 5, 8, 9)
rt.insert('r1234', 1, 2, 3, 4)
rt.insert('r3456', 1, 1, 9, 9) # wrong
rt.update_or_insert('r3456', 2, 2, 8, 8) # still wrong
rt['r3456'] = [3, 4, 5, 6] # correct

p rt['r3589'] # [3, 5, 8, 9]

puts rt.intersects?(0.9, 0.9, 2.1, 2.1) # should be r2277 and r1234


puts rt.nearest_k(10, 10, 2) # should be r3589 and r2277

puts rt.nearest(10, 10) # should be r3589

rt.remove('r3589')
puts rt.nearest_k(10, 10, 2) # now should be r3456 and r2277

puts rt.nearest_k_rect(10, 10, 2) # returns array -- object and minx, miny, maxx, maxy

puts rt.nearest_rect(10, 10) # returns array -- object and minx, miny, maxx, maxy

rt.nearest_k_rect_each(10, 10, 2){|r| print r[0], ' has area ', (r[3] - r[1]) * (r[4] - r[2]), "\n"}

rt.each_pair{|el| puts el}
rt.delete('r2277')
rt.each_pair{|el| puts el}

a = rt.to_a
a.each{|el| p el}
