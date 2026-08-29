table 71332 "CG X149 Allocation Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Document No."; Code[20]) { }
        field(3; "Line No."; Integer) { }
        field(4; "Department Code"; Code[10]) { }
        field(5; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }
}
