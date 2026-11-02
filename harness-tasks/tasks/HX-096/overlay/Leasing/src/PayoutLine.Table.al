table 70342 "CGR Payout Line"
{
    DataClassification = CustomerContent;

    // One proposed payment. Share Line No. 0 is the owner's own line; any other value is the
    // payout of that third-party share.
    fields
    {
        field(1; "Line No."; Integer) { }
        field(2; "Statement Entry No."; Integer) { }
        field(3; "Share Line No."; Integer) { }
        field(4; "Payee Code"; Code[20]) { }
        field(5; Amount; Decimal) { }
        field(6; "To Be Paid"; Boolean) { }
    }

    keys
    {
        key(PK; "Line No.") { Clustered = true; }
        key(Statement; "Statement Entry No.", "Share Line No.") { }
    }
}
