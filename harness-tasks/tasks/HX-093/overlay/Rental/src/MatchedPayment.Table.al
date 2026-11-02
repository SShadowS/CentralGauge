table 70244 "CGR Matched Payment"
{
    DataClassification = CustomerContent;

    // The card payment a bank statement line was matched to. Its payment method can differ from the
    // one on the contract.
    fields
    {
        field(1; "Contract No."; Code[20]) { TableRelation = "CGR Rental Contract"; }
        field(2; "Payment Method Code"; Code[10]) { TableRelation = "CGR Payment Method"; }
        field(3; Amount; Decimal) { }
        field(4; "Externally Settled"; Boolean) { }
    }

    keys
    {
        key(PK; "Contract No.") { Clustered = true; }
    }
}
