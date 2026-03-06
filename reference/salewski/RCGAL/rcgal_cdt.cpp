#include "ruby.h"

// file: rcgal_cdt.cpp
// note: source code is indented with tabs, tab-width=2

// Ruby bindings for CGAL C++ library, some support for
// CDT Constrained Delaunay Triangulation
// http://www.cgal.org/
// http://media.pragprog.com/titles/ruby3/ext_ruby.pdf
// /usr/share/doc/ruby-1.9.3_p286/README.EXT.bz2
// http://www.angelfire.com/electronic2/issac/rb_cpp_ext_tut.txt
//
// c Stefan Salewsk, mail@ssalewski.de
// License GPL
// Version 0.3 14-OCT-2013
//
// build: cd RCGAL; ruby extconf.rb; make cppflags+=-frounding-math

struct MyInfo
{
	VALUE rvertex;
	void *parent;
	MyInfo():
		rvertex(Qnil),
		parent(NULL)
	{}
};

struct FaceInfo2
{
  FaceInfo2(){}
  int nesting_level;

  bool in_domain(){ 
    return nesting_level%2 == 1;
  }
};

#include <CGAL/Polygon_2.h>

#define DFT 1

#if DFT

#include <CGAL/Exact_predicates_inexact_constructions_kernel.h>
#include <CGAL/Triangulation_face_base_with_info_2.h>
#include <CGAL/Triangulation_vertex_base_with_info_2.h>
#include <CGAL/Constrained_Delaunay_triangulation_2.h>
#include <CGAL/range_search_delaunay_2.h>
#include <vector>

#include <CGAL/Triangulation_hierarchy_2.h>
#include <CGAL/Constrained_triangulation_plus_2.h>

typedef CGAL::Exact_predicates_inexact_constructions_kernel K;

typedef CGAL::Triangulation_vertex_base_with_info_2<MyInfo, K>	 Vbb;
typedef CGAL::Triangulation_hierarchy_vertex_base_2<Vbb> Vb;

//typedef CGAL::Constrained_triangulation_face_base_2<K>					 Fb;
typedef CGAL::Triangulation_face_base_with_info_2<FaceInfo2,K>    Fbb;
typedef CGAL::Constrained_triangulation_face_base_2<K,Fbb>        Fb;

typedef CGAL::Triangulation_data_structure_2<Vb, Fb>						 TDS;
typedef CGAL::Exact_predicates_tag															 Itag;
typedef CGAL::Constrained_Delaunay_triangulation_2<K, TDS, Itag> CDa;
typedef CGAL::Triangulation_hierarchy_2<CDa>             CDTH;
typedef CGAL::Constrained_triangulation_plus_2<CDTH>     CDT;



typedef CDT::Point					Point;

//typedef std::vector<CDT::Vertex_handle> Vector;
typedef std::vector<typename CDT::Vertex_handle> Vector;

typedef CGAL::Circle_2<K>					Circle_2;

typedef VALUE (ruby_method)(...);

#else

#include <CGAL/Exact_predicates_inexact_constructions_kernel.h>
#include <CGAL/Triangulation_face_base_with_info_2.h>
#include <CGAL/Triangulation_vertex_base_with_info_2.h>
#include <CGAL/Constrained_Delaunay_triangulation_2.h>
//#include <boost/static_assert.hpp>
//#include <cassert>
//#include <iostream>


typedef CGAL::Exact_predicates_inexact_constructions_kernel K;
typedef CGAL::Triangulation_vertex_base_with_info_2<MyInfo, K>	 Vb;
//typedef CGAL::Constrained_triangulation_face_base_2<K>					 Fb;
typedef CGAL::Triangulation_face_base_with_info_2<FaceInfo2,K>    Fbb;
typedef CGAL::Constrained_triangulation_face_base_2<K,Fbb>        Fb;

typedef CGAL::Triangulation_data_structure_2<Vb, Fb>						 TDS;
typedef CGAL::Exact_predicates_tag															 Itag;
typedef CGAL::Constrained_Delaunay_triangulation_2<K, TDS, Itag> CDT;
typedef CDT::Point					Point;

typedef VALUE (ruby_method)(...);

#endif

VALUE cCDT;
VALUE cVertex;
VALUE cVH;

ID ID_vertex_x;
ID ID_vertex_y;
ID ID_vertex_vh;
ID ID_vertex_cdt;

extern "C" void cdt_del(void* p)
{
	CDT *t = (CDT*) p;
	for (CDT::Finite_vertices_iterator i = t->finite_vertices_begin();
			 i != t->finite_vertices_end();
			 ++i)
	{
		rb_ivar_set(i->info().rvertex, ID_vertex_vh, Qnil);
	}
	delete (CDT*) p;
}

extern "C" void cdt_mark(void *p)
{
	CDT *t = (CDT*) p;
	for (CDT::Finite_vertices_iterator i = t->finite_vertices_begin();
			 i != t->finite_vertices_end();
			 ++i)
	{
		rb_gc_mark(i->info().rvertex);
	}
}

extern "C" VALUE cdt_alloc(VALUE klass)
{
	CDT *t = new CDT;
	return Data_Wrap_Struct(klass, cdt_mark, cdt_del, t);
}

extern "C" VALUE cdt_init(VALUE self)
{
	return self;
}

extern "C" VALUE vertex_init(VALUE self, VALUE x, VALUE y)
{
	rb_ivar_set(self, ID_vertex_x, x);
	rb_ivar_set(self, ID_vertex_y, y);
	rb_ivar_set(self, ID_vertex_cdt, Qnil);
	return self;
}

extern "C" VALUE vertex_x(VALUE self)
{
	return rb_ivar_get(self, ID_vertex_x);
}

extern "C" VALUE vertex_y(VALUE self)
{
	return rb_ivar_get(self, ID_vertex_y);
}

extern "C" VALUE cdt_to_a(VALUE self)
{
	CDT *t;
	VALUE arr = rb_ary_new();
	Data_Get_Struct(self, CDT, t);
	for (CDT::Finite_vertices_iterator i = t->finite_vertices_begin();
			 i != t->finite_vertices_end();
			 ++i)
	{
		rb_ary_push(arr, i->info().rvertex);
	}
	return arr;
}

extern "C" VALUE cdt_each(VALUE self)
{
	CDT *t;
	Data_Get_Struct(self, CDT, t);
	for (CDT::Finite_vertices_iterator i = t->finite_vertices_begin();
			 i != t->finite_vertices_end();
			 ++i)
	{
		rb_yield(i->info().rvertex);
	}
	return self;
}

extern "C" void vh_del(void* p)
{
	delete (CDT::Vertex_handle*) p;
}

extern "C" VALUE cdt_insert(VALUE self, VALUE vertex)
{
	CDT *t;
	Data_Get_Struct(self, CDT, t);
	CDT::Vertex_handle *vh = new CDT::Vertex_handle;
	*vh = t->insert(Point(NUM2DBL(rb_ivar_get(vertex, ID_vertex_x)), NUM2DBL(rb_ivar_get(vertex, ID_vertex_y))));
	(*vh)->info().rvertex = vertex;
	(*vh)->info().parent = t;
	VALUE h = Data_Wrap_Struct(cVH, 0, vh_del, vh);
	rb_ivar_set(vertex, ID_vertex_vh, h);
	return self;
}

// this is for vertices already existing in CDT
extern "C" VALUE cdt_insert_constraint(VALUE self, VALUE vertex1, VALUE vertex2)
{
	CDT *t;
	CDT::Vertex_handle *h1;
	CDT::Vertex_handle *h2;
	Data_Get_Struct(self, CDT, t);
	VALUE vh1 = rb_attr_get(vertex1, ID_vertex_vh);
	VALUE vh2 = rb_attr_get(vertex2, ID_vertex_vh);
	if (NIL_P(vh1) || NIL_P(vh2))
		rb_raise(rb_eRuntimeError, "CGAL::CDT.insert_constraint(), vertices must already exist in CDT!");
	Data_Get_Struct(vh1, CDT::Vertex_handle,	h1);
	Data_Get_Struct(vh2, CDT::Vertex_handle,	h2);
	t->insert_constraint(*h1, *h2);
	return self;
}

extern "C" VALUE cdt_neighbor_vertices(VALUE self, VALUE vertex)
{
	CDT *t;
	CDT::Vertex_handle *vh;
	Data_Get_Struct(self, CDT, t);
	VALUE h = rb_attr_get(vertex, ID_vertex_vh);
	if (NIL_P(h))
		rb_raise(rb_eRuntimeError, "CGAL::CDT.neighbor_vertices, vertex does not exist in CDT!");
	Data_Get_Struct(h, CDT::Vertex_handle,	vh);
	if ((*vh)->info().parent != t)
		rb_raise(rb_eRuntimeError, "CGAL::CDT.neighbor_vertices, vertex does not exist in THIS CDT!");
	VALUE arr = rb_ary_new();
	CDT::Vertex_circulator vc = t->incident_vertices(*vh), done(vc);
	do
	{
		if (!t->is_infinite(vc))
		{
			rb_ary_push(arr, vc->info().rvertex);
		}
	} while (++vc != done);
	return arr;
}

extern "C" VALUE cdt_range_search(VALUE self, VALUE px, VALUE py, VALUE r)
{
	CDT *t;
	Data_Get_Struct(self, CDT, t);
	VALUE arr = rb_ary_new();
	Vector vertices;
	double h = NUM2DBL(r);
	Circle_2 circ(Point(NUM2DBL(px), NUM2DBL(py)), h * h);
  range_search(*t, circ, std::back_inserter(vertices));
	for (Vector::iterator i = vertices.begin(); i != vertices.end(); i++){
		rb_ary_push(arr, (*i)->info().rvertex);
	}
	return arr;
}

// text
// 

void 
mark_domains(CDT& ct, 
             CDT::Face_handle start, 
             int index, 
             std::list<CDT::Edge>& border )
{
  if(start->info().nesting_level != -1){
    return;
  }
  std::list<CDT::Face_handle> queue;
  queue.push_back(start);

  while(! queue.empty()){
    CDT::Face_handle fh = queue.front();
    queue.pop_front();
    if(fh->info().nesting_level == -1){
      fh->info().nesting_level = index;
      for(int i = 0; i < 3; i++){
        CDT::Edge e(fh,i);
        CDT::Face_handle n = fh->neighbor(i);
        if(n->info().nesting_level == -1){
          if(ct.is_constrained(e)) border.push_back(e);
          else queue.push_back(n);
        }
      }
    }
  }
}

//explore set of facets connected with non constrained edges,
//and attribute to each such set a nesting level.
//We start from facets incident to the infinite vertex, with a nesting
//level of 0. Then we recursively consider the non-explored facets incident 
//to constrained edges bounding the former set and increase the nesting level by 1.
//Facets in the domain are those with an odd nesting level.
void
mark_domains(CDT& cdt)
{
  for(CDT::All_faces_iterator it = cdt.all_faces_begin(); it != cdt.all_faces_end(); ++it){
    it->info().nesting_level = -1;
  }

  int index = 0;
  std::list<CDT::Edge> border;
  mark_domains(cdt, cdt.infinite_face(), index++, border);
  while(! border.empty()){
    CDT::Edge e = border.front();
    border.pop_front();
    CDT::Face_handle n = e.first->neighbor(e.second);
    if(n->info().nesting_level == -1){
      mark_domains(cdt, n, e.first->info().nesting_level+1, border);
    }
  }
}

/*
void insert_polygon(CDT& cdt,const Polygon_2& polygon){
  if ( polygon.is_empty() ) return;
  CDT::Vertex_handle v_prev=cdt.insert(*CGAL::cpp11::prev(polygon.vertices_end()));
  for (Polygon_2::Vertex_iterator vit=polygon.vertices_begin();
       vit!=polygon.vertices_end();++vit)
  {
    CDT::Vertex_handle vh=cdt.insert(*vit);
    cdt.insert_constraint(vh,v_prev);
    v_prev=vh;
  }  
}
*/

static VALUE cdt_edges_in_constrained_polygons(VALUE self)
{
  std::cout << "cdt_edges_in_constrained_polygons" << std::endl;

	CDT *cdt;
//	CDT::Vertex_handle *vh;
	Data_Get_Struct(self, CDT, cdt);
//	VALUE h = rb_attr_get(vertex, ID_vertex_vh);
//	if (NIL_P(h))
//		rb_raise(rb_eRuntimeError, "CGAL::CDT.neighbor_vertices, vertex does not exist in CDT!");
//	Data_Get_Struct(h, CDT::Vertex_handle,	vh);
//	if ((*vh)->info().parent != t)
//		rb_raise(rb_eRuntimeError, "CGAL::CDT.neighbor_vertices, vertex does not exist in THIS CDT!");
//	VALUE arr = rb_ary_new();
//	CDT::Vertex_circulator vc = t->incident_vertices(*vh), done(vc);
//	do
//	{
//		if (!t->is_infinite(vc))
//		{
//			rb_ary_push(arr, vc->info().rvertex);
//		}
//	} while (++vc != done);
//	return arr;
//}

//int main( )
//{
  //construct two non-intersecting nested polygons  
//  Polygon_2 polygon1;
//  polygon1.push_back(Point(0,0));
//  polygon1.push_back(Point(2,0));
//  polygon1.push_back(Point(2,2));
//  polygon1.push_back(Point(0,2));
//  Polygon_2 polygon2;
//  polygon2.push_back(Point(0.5,0.5));
//  polygon2.push_back(Point(1.5,0.5));
//  polygon2.push_back(Point(1.5,1.5));
//  polygon2.push_back(Point(0.5,1.5));
  
  //Insert the polyons into a constrained triangulation
//  CDT cdt;
//  insert_polygon(cdt,polygon1);
//  insert_polygon(cdt,polygon2);
  
  //Mark facets that are inside the domain bounded by the polygon
  mark_domains(*cdt);
  
  int count=0;
	int vc = 0;
	CDT::Vertex_handle v1, v2;
	CDT::Face_handle fh;

  for (CDT::Finite_faces_iterator fit=cdt->finite_faces_begin();
                                  fit!=cdt->finite_faces_end();++fit)
  {
    if ( fit->info().in_domain() )
		{
			++count;
			for (int i = 0; i < 3; i++)
			{
				fh = fit->neighbor(i);
				if ( fh->info().in_domain() )
				{
					v1 = fit->vertex(cdt->cw(i));
					v2 = fit->vertex(cdt->ccw(i));
					rb_yield(rb_ary_new3(2, v1->info().rvertex, v2->info().rvertex));
//rb_ary_push(arr, vc->info().rvertex);


					vc++;
					//if ( fh->info().in_domain() ) ++count;
				}
			}
		}

  }

  std::cout << "There are " << count << " facets in the domain." << std::endl;
  std::cout << "There are " << vc << " something." << std::endl;

  return Qnil;
}


extern "C" void Init_rcgal_cdt() {
	ID_vertex_x = rb_intern("vertex_x_name");
	ID_vertex_y = rb_intern("vertex_y_name");
	ID_vertex_vh = rb_intern("vertex_vh_name");
	ID_vertex_cdt = rb_intern("vertex_cdt_name");
	VALUE mCGAL = rb_define_module("CGAL");
	cCDT = rb_define_class_under(mCGAL, "CDT", rb_cObject);
	cVertex = rb_define_class_under(mCGAL, "Vertex", rb_cObject);
	cVH = rb_define_class_under(mCGAL, "VH", rb_cObject);
	rb_define_alloc_func(cCDT, cdt_alloc);
	rb_define_method(cCDT, "initialize", (ruby_method*) &cdt_init, 0);
	rb_define_method(cVertex, "initialize", (ruby_method*) &vertex_init, 2);
	rb_define_method(cVertex, "x", (ruby_method*) &vertex_x, 0);
	rb_define_method(cVertex, "y", (ruby_method*) &vertex_y, 0);
	rb_define_method(cCDT, "insert", (ruby_method*) &cdt_insert, 1);
	rb_define_method(cCDT, "insert_constraint", (ruby_method*) &cdt_insert_constraint, 2);
	rb_define_method(cCDT, "neighbor_vertices", (ruby_method*) &cdt_neighbor_vertices, 1);
	rb_define_method(cCDT, "range_search", (ruby_method*) &cdt_range_search, 3);
	rb_define_method(cCDT, "to_a", (ruby_method*) &cdt_to_a, 0);
	rb_define_method(cCDT, "each", (ruby_method*) &cdt_each, 0);
	rb_define_method(cCDT, "edges_in_constrained_polygons", (ruby_method*) &cdt_edges_in_constrained_polygons, 0);
}
