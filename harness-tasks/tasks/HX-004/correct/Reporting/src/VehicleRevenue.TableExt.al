tableextension 70500 "CGR Vehicle Revenue" extends "CGR Vehicle"
{
    fields
    {
        field(70500; "Date Filter"; Date)
        {
            FieldClass = FlowFilter;
        }
        field(70501; "Rental Revenue"; Decimal)
        {
            FieldClass = FlowField;
            CalcFormula = sum("CGR Rental Ledger Entry".Amount where("Vehicle No." = field("No."), "Posting Date" = field("Date Filter")));
            Editable = false;
        }
        field(70502; "Lease Revenue"; Decimal)
        {
            FieldClass = FlowField;
            CalcFormula = sum("CGR Lease Schedule Line".Amount where("Vehicle No." = field("No."), Invoiced = const(true), "Due Date" = field("Date Filter")));
            Editable = false;
        }
    }
}
