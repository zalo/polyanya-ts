require 'mkmf'

if have_library("CGAL") and have_library("CGAL_Core") and have_library("gmp")
	$CXXFLAGS += " -frounding-math -std=c++11"
	create_makefile("rcgal_apollonius")
else
  puts 'missing CGAL library'
end
