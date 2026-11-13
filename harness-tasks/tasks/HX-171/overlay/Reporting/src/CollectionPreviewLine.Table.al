table 70590 "CGR Collection Preview Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Contract No."; Code[20]) { }
        field(2; "Line No."; Integer) { }
        field(3; "Due Date"; Date) { }
        field(4; Amount; Decimal) { }
        field(5; "Error Text"; Text[250]) { }
    }

    keys
    {
        key(PK; "Contract No.", "Line No.") { Clustered = true; }
    }
}
