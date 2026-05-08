table 69071 "CG SACF Child"
{
    Caption = 'CG SACF Child';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
        }
        field(10; "Parent No."; Code[20])
        {
            Caption = 'Parent No.';
            TableRelation = "CG SACF Parent"."No.";
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
        key(ParentNo; "Parent No.") { }
    }
}
