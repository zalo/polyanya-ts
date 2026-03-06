#include "ruby.h"

// file: rboost_fibonacci_queue.cpp
// note: source code is indented with tabs, tab-width=2

// Ruby bindings for boost C++ library, support for
// heap/Fibonacci_Queue
// http://www.boost.org/
// http://www.boost.org/doc/libs/1_54_0/doc/html/heap.html
// http://media.pragprog.com/titles/ruby3/ext_ruby.pdf
// /usr/share/doc/ruby-2.0.0_p247-r1/README.EXT.bz2
// http://www.angelfire.com/electronic2/issac/rb_cpp_ext_tut.txt
//
// There is already a fine Fibonacci_Queue of Brian Schroeder available at
// http://rubygems.org/gems/PriorityQueue
//
// I was not sure if that one is still maintained, so I wrote an interface
// to boost library. Behaviour and speed is similar to Brians's.
//
// This Queue has a few minor limitations:
// - A node is allowed to be only in one Queue at a time
// - The same node can not exist multiple times in a queue
// - We do not check content of nodes -- you can insert equal string constants multiple times
// - Key datatype for priority is float (you can not direct use Strings as keys...)
//
// c Stefan Salewsk, mail@ssalewski.de
// License GPL
// Version 0.2 04-SEP-2013
// tested for Ruby 1.9.3 and Ruby 2.0

#include <boost/heap/fibonacci_heap.hpp>

using boost::heap::fibonacci_heap;

ID ID_heap_node_heap_data;
VALUE cFQ;
VALUE cHD;

struct heap_data
{
	fibonacci_heap<heap_data>::handle_type handle;
	double payload; // payload is our key for sorting
	VALUE data; // Ruby object
	VALUE parent_queue; // the queue the object is in -- or nil
	heap_data(double k):
		payload(k)
	{}
	bool operator<(heap_data const & rhs) const
	{
		return payload < rhs.payload; // largest key at the top -- boost default
	}
};

class XPQ : public boost::heap::fibonacci_heap<heap_data>
{
public:
	VALUE nil_result;
	int key_sign; // +1 or -1 for Max or Min Heap
};

double convert_key(VALUE key)
{
	switch (TYPE(key))
	{
		case T_FIXNUM:
		case T_FLOAT:
			return NUM2DBL(key);
			break;
		default:
			rb_raise(rb_eTypeError, "Fibonacci_Queue: key type must be float or fixnum!");
			break;
	}
}

extern "C" void fqueue_del(void* p)
{
	delete (XPQ*) p;
}

extern "C" void fqueue_mark(void *p)
{
	XPQ *pq = (XPQ*) p;
	for (XPQ::iterator it = pq->begin(); it != pq->end(); ++it)
		rb_gc_mark(it->data);
}

extern "C" VALUE fqueue_alloc(VALUE klass)
{
	XPQ *pq = new XPQ;
	return Data_Wrap_Struct(klass, fqueue_mark, fqueue_del, pq);
}

extern "C" VALUE fqueue_init(int argc, VALUE* argv, VALUE self)
{
	XPQ *pq;
	Data_Get_Struct(self, XPQ, pq);
	if (argc > 2)
		rb_raise(rb_eArgError, "wrong number of arguments");
	if (argc == 2)
	{
		argc--;
		pq->nil_result = argv[1];
	}
	else
		pq->nil_result = Qnil; 
	if (argc == 0)
		pq->key_sign = -1;
	else
	{
		if (TYPE(argv[0]) != T_FIXNUM)
			rb_raise(rb_eArgError, "use +1 or -1");
		else
		{
			int i = NUM2INT(argv[0]);
			if ((i != 1) && (i != -1))
				rb_raise(rb_eArgError, "use +1 or -1");
			else
				pq->key_sign = i;
		}
	}
	return self;
}

extern "C" void fqueue_heap_data_free(void* hd)
{
	delete (heap_data*) hd;
}

extern "C" VALUE fqueue_each(VALUE self)
{
	VALUE a;
	XPQ *pq;
	Data_Get_Struct(self, XPQ, pq);
	for (XPQ::iterator it = pq->begin(); it != pq->end(); ++it)
	{
		a = rb_ary_new2(2);
		rb_ary_push(a, it->data);
		rb_ary_push(a, rb_float_new(it->payload * pq->key_sign));
		rb_yield(a);
	}
	return self;
}

extern "C" VALUE fqueue_to_a(VALUE self)
{
	VALUE a;
	XPQ *pq;
	VALUE arr = rb_ary_new();
	Data_Get_Struct(self, XPQ, pq);
	for (XPQ::iterator it = pq->begin(); it != pq->end(); ++it)
	{
		a = rb_ary_new2(2);
		rb_ary_push(a, it->data);
		rb_ary_push(a, rb_float_new(it->payload * pq->key_sign));
		rb_ary_push(arr, a);
	}
	return arr;
}

void fq_push(VALUE q, VALUE d, VALUE key)
{
	XPQ *pq;
	Data_Get_Struct(q, XPQ, pq);
	double k = convert_key(key) * pq->key_sign;
	heap_data* hd = new heap_data(k);
	hd->data = d;
	hd->parent_queue = q;
	XPQ::handle_type handle = pq->push(*hd);
	//(*handle).handle = handle;
	hd->handle = handle;
	VALUE h = Data_Wrap_Struct(cHD, 0, fqueue_heap_data_free, hd);
	rb_ivar_set(d, ID_heap_node_heap_data, h);
}

extern "C" VALUE fqueue_push(VALUE self, VALUE node, VALUE key)
{
	if (NIL_P(rb_attr_get(node, ID_heap_node_heap_data)))
		fq_push(self, node, key);
	else
		rb_raise(rb_eRuntimeError, "Fibonacci_Queue.push(): node is already in a queue!");
	return Qnil;
}

extern "C" VALUE fqueue_delete(VALUE self, VALUE node)
{
	heap_data* h;
	XPQ *pq;
	VALUE hd = rb_attr_get(node, ID_heap_node_heap_data);
	if (NIL_P(hd))
		return Qfalse;
	else
	{
		Data_Get_Struct(hd, heap_data, h);
		if (h->parent_queue == self)
		{
			Data_Get_Struct(self, XPQ, pq);
			rb_ivar_set(node, ID_heap_node_heap_data, Qnil);
			pq->erase(h->handle);
		}
		else
			rb_raise(rb_eRuntimeError, "Fibonacci_Queue.delete(): node is inserted in a different queue!");
	}
	return Qtrue;
}

void fq_update(VALUE q, VALUE hd, VALUE key)
{
	XPQ *pq;
	heap_data* h;
	Data_Get_Struct(q, XPQ, pq);
	Data_Get_Struct(hd, heap_data, h);
	if (h->parent_queue == q)
	{
		(*h->handle).payload = convert_key(key) * pq->key_sign;
		pq->update(h->handle);
	}
	else
		rb_raise(rb_eRuntimeError, "Fibonacci_Queue.update(): node is inserted in a different queue!");
}

void fq_increase(VALUE q, VALUE hd, VALUE key)
{
	XPQ *pq;
	heap_data* h;
	Data_Get_Struct(q, XPQ, pq);
	Data_Get_Struct(hd, heap_data, h);
	if (h->parent_queue == q)
	{
		(*h->handle).payload = convert_key(key) * pq->key_sign;
		pq->increase(h->handle);
	}
	else
		rb_raise(rb_eRuntimeError, "Fibonacci_Queue.increase(): node is inserted in a different queue!");
}

void fq_decrease(VALUE q, VALUE hd, VALUE key)
{
	XPQ *pq;
	heap_data* h;
	Data_Get_Struct(q, XPQ, pq);
	Data_Get_Struct(hd, heap_data, h);
	if (h->parent_queue == q)
	{
		(*h->handle).payload = convert_key(key) * pq->key_sign;
		pq->decrease(h->handle);
	}
	else
		rb_raise(rb_eRuntimeError, "Fibonacci_Queue.decrease(): node is inserted in a different queue!");
}

extern "C" VALUE fqueue_update(VALUE self, VALUE node, VALUE key)
{
	VALUE hd = rb_attr_get(node, ID_heap_node_heap_data);
	if (NIL_P(hd))
		return Qfalse;
	else
		fq_update(self, hd, key);
	return Qtrue;
}

extern "C" VALUE fqueue_increase(VALUE self, VALUE node, VALUE key)
{
	VALUE hd = rb_attr_get(node, ID_heap_node_heap_data);
	if (NIL_P(hd))
		return Qfalse;
	else
		fq_increase(self, hd, key);
	return Qtrue;
}

extern "C" VALUE fqueue_decrease(VALUE self, VALUE node, VALUE key)
{
	VALUE hd = rb_attr_get(node, ID_heap_node_heap_data);
	if (NIL_P(hd))
		return Qfalse;
	else
		fq_decrease(self, hd, key);
	return Qtrue;
}

extern "C" VALUE fqueue_update_or_insert(VALUE self, VALUE node, VALUE key)
{
	VALUE hd = rb_attr_get(node, ID_heap_node_heap_data);
	if (NIL_P(hd))
		fq_push(self, node, key);
	else
		fq_update(self, hd, key);
	return Qnil;
}

extern "C" VALUE fqueue_inc(VALUE self, VALUE node, VALUE key)
{
	XPQ *pq;
	heap_data* h;
	VALUE hd = rb_attr_get(node, ID_heap_node_heap_data);
	if (NIL_P(hd))
		fq_push(self, node, key);
	else
	{
		Data_Get_Struct(self, XPQ, pq);
		double k = convert_key(key) * pq->key_sign;
		Data_Get_Struct(hd, heap_data, h);
		if ((*h->handle).payload < k)
		{
			(*h->handle).payload = k;
			pq->increase(h->handle);
			return Qtrue;
		}
	}
	return Qfalse;
}

extern "C" VALUE fqueue_dec(VALUE self, VALUE node, VALUE key)
{
	XPQ *pq;
	heap_data* h;
	VALUE hd = rb_attr_get(node, ID_heap_node_heap_data);
	if (NIL_P(hd))
		fq_push(self, node, key);
	else
	{
		Data_Get_Struct(self, XPQ, pq);
		double k = convert_key(key) * pq->key_sign;
		Data_Get_Struct(hd, heap_data, h);
		if ((*h->handle).payload > k)
		{
			(*h->handle).payload = k;
			pq->decrease(h->handle);
			return Qtrue;
		}
	}
	return Qfalse;
}

extern "C" VALUE fqueue_key(VALUE self, VALUE node)
{
	XPQ *pq;
	heap_data* h;
	Data_Get_Struct(self, XPQ, pq);
	VALUE hd = rb_attr_get(node, ID_heap_node_heap_data);
	if (NIL_P(hd))
		return pq->nil_result;
	else
	{
		Data_Get_Struct(hd, heap_data, h);
		if (h->parent_queue == self)
		{
			return rb_float_new((*h->handle).payload * pq->key_sign);
		}
		else
			rb_raise(rb_eRuntimeError, "Fibonacci_Queue.key(): node is inserted in a different queue!");
	}
	return Qnil;
}

extern "C" VALUE fqueue_include(VALUE self, VALUE node)
{
	heap_data* h;
	VALUE hd = rb_attr_get(node, ID_heap_node_heap_data);
	if (NIL_P(hd))
		return Qfalse;
	else
	{
		Data_Get_Struct(hd, heap_data, h);
		return ((h->parent_queue == self) ? Qtrue : Qfalse);
	}
}

extern "C" VALUE fqueue_clear(VALUE self)
{
	XPQ *pq;
	Data_Get_Struct(self, XPQ, pq);
	for (XPQ::iterator it = pq->begin(); it != pq->end(); ++it)
		rb_ivar_set(it->data, ID_heap_node_heap_data, Qnil);
	pq->clear();
	return Qnil;
}

extern "C" VALUE fqueue_empty(VALUE self)
{
	XPQ *pq;
	Data_Get_Struct(self, XPQ, pq);
	return (pq->empty() ? Qtrue : Qfalse);
}

/*
extern "C" VALUE fqueue_merge(VALUE self, VALUE other)
{
	XPQ *pq1;
	XPQ *pq2;
	if (!rb_obj_is_kind_of(other, cFQ))
		rb_raise(rb_eRuntimeError, "Fibonacci_Queue.merge(): wrong data type!");
	Data_Get_Struct(self, XPQ, pq1);
	Data_Get_Struct(other, XPQ, pq2);
	//if (pq2->empty()) return self;
	if (pq1->key_sign != pq2->key_sign)
		rb_raise(rb_eRuntimeError, "Fibonacci_Queue.merge(): can not merge min queue with max queue!");
	for (XPQ::iterator it = pq2->begin(); it != pq2->end(); ++it)
		it->parent_queue == self; // this will not work
	pq1->merge(*pq2);
	pq2->clear();
	return self;
}
*/

extern "C" VALUE fqueue_length(VALUE self)
{
	XPQ *pq;
	Data_Get_Struct(self, XPQ, pq);
	return INT2FIX(pq->size());
}

extern "C" VALUE fqueue_top(VALUE self)
{
	XPQ *pq;
	Data_Get_Struct(self, XPQ, pq);
	if (pq->empty()) return Qnil;
	const heap_data& hd = pq->top();
	VALUE arr = rb_ary_new2(2);
	rb_ary_push(arr, hd.data);
	rb_ary_push(arr, rb_float_new(hd.payload * pq->key_sign));
	return arr;
}

extern "C" VALUE fqueue_top_data(VALUE self)
{
	XPQ *pq;
	Data_Get_Struct(self, XPQ, pq);
	return (pq->empty() ? Qnil : pq->top().data);
}

extern "C" VALUE fqueue_top_key(VALUE self)
{
	XPQ *pq;
	Data_Get_Struct(self, XPQ, pq);
	return (pq->empty() ? Qnil : rb_float_new(pq->top().payload * pq->key_sign));
}

extern "C" VALUE fqueue_delete_top(VALUE self)
{
	XPQ *pq;
	Data_Get_Struct(self, XPQ, pq);
	if (pq->empty()) return Qfalse;
	const heap_data& hd = pq->top();
	rb_ivar_set(hd.data, ID_heap_node_heap_data, Qnil);
	pq->pop();
	return Qtrue;
}

extern "C" VALUE fqueue_pop(VALUE self)
{
	XPQ *pq;
	Data_Get_Struct(self, XPQ, pq);
	if (pq->empty()) return Qnil;
	const heap_data& hd = pq->top();
	VALUE arr = rb_ary_new2(2);
	rb_ary_push(arr, hd.data);
	rb_ary_push(arr, rb_float_new(hd.payload * pq->key_sign));
	rb_ivar_set(hd.data, ID_heap_node_heap_data, Qnil);
	pq->pop();
	return arr;
}

extern "C" VALUE fqueue_pop_data(VALUE self)
{
	XPQ *pq;
	Data_Get_Struct(self, XPQ, pq);
	if (pq->empty()) return Qnil;
	const heap_data& hd = pq->top();
	VALUE data = hd.data;
	rb_ivar_set(data, ID_heap_node_heap_data, Qnil);
	pq->pop();
	return data;
}

extern "C" VALUE fqueue_pop_key(VALUE self)
{
	XPQ *pq;
	Data_Get_Struct(self, XPQ, pq);
	if (pq->empty()) return Qnil;
	const heap_data& hd = pq->top();
	rb_ivar_set(hd.data, ID_heap_node_heap_data, Qnil);
	VALUE f = rb_float_new(hd.payload * pq->key_sign);
	pq->pop();
	return f;
}

typedef VALUE (ruby_method)(...);

extern "C" void Init_rboost_fibonacci_queue() {
	ID_heap_node_heap_data = rb_intern("heap_node_heap_data_str");
	VALUE mBOOST = rb_define_module("BOOST");
	cFQ = rb_define_class_under(mBOOST, "Fibonacci_Queue", rb_cObject);
	cHD = rb_define_class_under(mBOOST, "Heap_Data", rb_cObject);
	rb_define_alloc_func(cFQ, fqueue_alloc);
	rb_define_method(cFQ, "initialize", (ruby_method*) &fqueue_init, -1);
	rb_define_method(cFQ, "each", (ruby_method*) &fqueue_each, 0);
	rb_define_method(cFQ, "to_a", (ruby_method*) &fqueue_to_a, 0);
	//rb_define_method(cFQ, "merge!", (ruby_method*) &fqueue_merge, 1);
	rb_define_method(cFQ, "push", (ruby_method*) &fqueue_push, 2);
	rb_define_alias(cFQ, "insert", "push");
	rb_define_method(cFQ, "clear", (ruby_method*) &fqueue_clear, 0);
	rb_define_method(cFQ, "empty?", (ruby_method*) &fqueue_empty, 0);
	rb_define_method(cFQ, "length", (ruby_method*) &fqueue_length, 0);
	rb_define_alias(cFQ, "size", "length");
	rb_define_method(cFQ, "include?", (ruby_method*) &fqueue_include, 1);
	rb_define_method(cFQ, "delete", (ruby_method*) &fqueue_delete, 1);
	//rb_define_alias(cFQ, "has_key?", "include?");
	rb_define_method(cFQ, "key", (ruby_method*) &fqueue_key, 1);
	rb_define_alias(cFQ, "[]", "key");
	rb_define_method(cFQ, "top", (ruby_method*) &fqueue_top, 0);
	//rb_define_alias(cFQ, "min", "top");
	rb_define_method(cFQ, "top_data", (ruby_method*) &fqueue_top_data, 0);
	rb_define_method(cFQ, "top_key", (ruby_method*) &fqueue_top_key, 0);
	rb_define_method(cFQ, "pop", (ruby_method*) &fqueue_pop, 0);
	//rb_define_alias(cFQ, "min_priority", "top_key");
	//rb_define_alias(cFQ, "delete_min", "pop");
	rb_define_method(cFQ, "pop_data", (ruby_method*) &fqueue_pop_data, 0);
	rb_define_method(cFQ, "pop_key", (ruby_method*) &fqueue_pop_key, 0);
	//rb_define_alias(cFQ, "delete_min_return_key", "pop_data");
	//rb_define_alias(cFQ, "delete_min_return_priority", "pop_key");
	rb_define_method(cFQ, "delete_top", (ruby_method*) &fqueue_delete_top, 0);
	rb_define_method(cFQ, "update", (ruby_method*) &fqueue_update, 2);
	rb_define_method(cFQ, "increase", (ruby_method*) &fqueue_increase, 2);
	rb_define_method(cFQ, "decrease", (ruby_method*) &fqueue_decrease, 2);
	rb_define_method(cFQ, "inc?", (ruby_method*) &fqueue_inc, 2);
	rb_define_method(cFQ, "dec?", (ruby_method*) &fqueue_dec, 2);
	rb_define_method(cFQ, "update_or_insert", (ruby_method*) &fqueue_update_or_insert, 2);
	rb_define_alias(cFQ, "[]=", "update_or_insert");
}
