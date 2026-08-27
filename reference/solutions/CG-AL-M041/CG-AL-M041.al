tableextension 70041 "CG FF Header Ext" extends "CG FF Header"
{
    fields
    {
        field(70041; "Total Amount"; Decimal)
        {
            Caption = 'Total Amount';
            FieldClass = FlowField;
            CalcFormula = sum("CG FF Line".Amount where("Header No." = field("No.")));
            Editable = false;
        }
    }
}