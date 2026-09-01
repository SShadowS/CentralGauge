table 71410 "CG X157 Cost Center"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20]) { }
        field(2; "Date Filter"; Date)
        {
            FieldClass = FlowFilter;
        }
        field(3; Balance; Decimal)
        {
            FieldClass = FlowField;
            CalcFormula = sum("CG X157 Cost Entry".Amount where("Cost Center Code" = field(Code)));
            Editable = false;
        }
        field(4; "Net Change"; Decimal)
        {
            FieldClass = FlowField;
            CalcFormula = sum("CG X157 Cost Entry".Amount where("Cost Center Code" = field(Code), "Posting Date" = field("Date Filter")));
            Editable = false;
        }
    }

    keys
    {
        key(PK; "Code")
        {
            Clustered = true;
        }
    }
}
