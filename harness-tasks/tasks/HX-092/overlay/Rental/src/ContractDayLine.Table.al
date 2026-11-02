table 70242 "CGR Contract Day Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Contract No."; Code[20]) { }
        field(2; "Line No."; Integer) { }
        field(3; "Vehicle No."; Code[20]) { }
        field(4; Days; Decimal) { }
        field(5; "Matched Days"; Decimal) { }
        field(6; "Billing Line No."; Integer) { }
    }

    keys
    {
        key(PK; "Contract No.", "Line No.") { Clustered = true; }
        key(Billing; "Billing Line No.") { SumIndexFields = "Matched Days"; }
    }
}
