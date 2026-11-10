table 70181 "CGR Premium Share"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Premium No."; Code[20]) { }
        field(2; "Line No."; Integer) { }
        field(3; "Vehicle No."; Code[20]) { }
        field(4; "Insured Value"; Decimal) { }
        field(5; "Share Amount"; Decimal) { }
    }

    keys
    {
        key(PK; "Premium No.", "Line No.") { Clustered = true; }
        key(Vehicle; "Premium No.", "Vehicle No.") { }
    }
}
