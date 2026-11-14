table 70393 "CGR Lease Return Charge"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Contract No."; Code[20]) { }
        field(2; "Line No."; Integer) { }
        field(3; Description; Text[100]) { }
        field(4; Amount; Decimal) { }
        field(5; "Bill Customer"; Boolean) { InitValue = true; }
    }

    keys
    {
        key(PK; "Contract No.", "Line No.") { Clustered = true; }
    }
}
