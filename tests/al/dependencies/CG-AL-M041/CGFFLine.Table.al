table 69081 "CG FF Line"
{
    Caption = 'CG FF Line';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
        }
        field(10; "Header No."; Code[20])
        {
            Caption = 'Header No.';
            TableRelation = "CG FF Header"."No.";
            NotBlank = true;
        }
        field(20; "Amount"; Decimal)
        {
            Caption = 'Amount';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(HeaderNo; "Header No.") { }
    }
}
