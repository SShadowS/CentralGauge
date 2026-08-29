table 71331 "CG X149 Allocation Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Document No."; Code[20]) { }
        field(2; "Line No."; Integer) { }
        field(3; "Department Code"; Code[10]) { }
        field(4; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Document No.", "Line No.")
        {
            Clustered = true;
        }
    }
}
