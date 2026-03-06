require 'mkmf'

if have_library("CGAL") and have_library("CGAL_Core") and have_library("gmp")
	$CFLAGS += " -frounding-math"
	create_makefile("rcgal_cdt")
else
  puts 'missing CGAL library'
end
