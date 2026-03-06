require_relative 'rboost_fibonacci_queue'

class My
	attr_accessor :x
	def initialize
  	@x = 44
	end
	def to_s
		print 'Instance of class My with @x = ', @x, "\n"
	end
end

q = BOOST::Fibonacci_Queue.new() # Min-Queue
my1 = My.new
my2 = My.new

q.push(my1, 12)
q.push(my2, 17)

my1.x = 37 # we can modify our data objects while insered in the queue!

puts q.top # => my1 with key == 12

q.update_or_insert(my1, 77)
q.update_or_insert(my2, 15) 

puts q.top # => my2 with key == 15

q.decrease(my2, 13) # we must be sure that new key is really smaller!
q.decrease(my1, 11)

puts q.top_key # => 11
puts q.top_data # => my1

puts q.pop # again my1 with key == 11

puts q.pop # now my2 with key == 13

puts q.length # 0 now

q.push(my1, 12)
q.push(my2, 17)

puts q.length # 2

q.clear

puts q.length # 0

puts (q.methods - Object.methods).sort

