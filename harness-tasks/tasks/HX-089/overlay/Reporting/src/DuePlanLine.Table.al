table 70522 "CGR Due Plan Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Contract No."; Code[20]) { }
        field(2; "Due Year"; Integer) { }
        field(3; "Due Month"; Integer) { }
        field(4; Amount; Decimal) { }
        field(5; Lines; Integer) { }
    }

    keys
    {
        key(PK; "Contract No.", "Due Year", "Due Month") { Clustered = true; }
    }
}
